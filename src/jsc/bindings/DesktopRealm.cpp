#include "root.h"

#include "DesktopRealm.h"

#include "BunClientData.h"
#include "BunCompiledModules.h"
#include "InternalModuleRegistry.h"
#include "JSDOMExceptionHandling.h"
#include "CodeGenerationFromStrings.h"
#include "DesktopLazy.h"
#include "MessagePortPipe.h"
#include "ScriptExecutionContext.h"
#include "SerializedScriptValue.h"
#include "ZigGlobalObject.h"
#include "streams/JSReadableStream.h"

#include <JavaScriptCore/AOTRealmStartup.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/GetterSetter.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/ImmutablePropertyNames.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ScriptFetchParameters.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/WebAssemblyCompileOptions.h>

namespace Bun {

using namespace JSC;

static void trackRejection(JSGlobalObject*, JSPromise*, JSPromiseRejectionOperation);

static bool isInStaticTable(JSObject* realm, PropertyName name)
{
    return !realm->staticPropertiesReified() && realm->structure()->findPropertyHashEntry(name);
}

// To delete a name of a static table is to make all that the table has. `undefined` in front of it hides it.
class RealmGlobal final : public Zig::GlobalObject {
public:
    using Base = Zig::GlobalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags | OverridesGetOwnPropertyNames;
    static constexpr unsigned hiddenAttributes = static_cast<unsigned>(PropertyAttribute::DontEnum);
    static const ClassInfo s_info;
    static constexpr const ClassInfo* info() { return &s_info; }

    static Structure* createStructure(VM& vm)
    {
        auto* structure = Structure::create(vm, nullptr, jsNull(), TypeInfo(GlobalObjectType, StructureFlags & ~IsImmutablePrototypeExoticObject), info());
        structure->setTransitionWatchpointIsLikelyToBeFired(true);
        return structure;
    }

    static bool isHidden(JSObject* object, PropertyName name)
    {
        unsigned attributes;
        PropertyOffset offset = object->getDirectOffset(object->vm(), name, attributes);
        return isValidOffset(offset) && attributes == hiddenAttributes && object->getDirect(offset).isUndefined() && object->structure()->findPropertyHashEntry(name);
    }

    // The accessors that scripts see in place of values that can be cached.
    static const Identifier& constantsName(VM& vm) { return WebCore::builtinNames(vm).originalColumnPrivateName(); }

    static GetterSetter* accessorOfConstant(JSObject* object, PropertyName name, unsigned& attributes)
    {
        VM& vm = object->vm();
        JSValue constants = object->getDirect(vm, constantsName(vm));
        JSValue accessor = constants ? asObject(constants)->getDirect(vm, name, attributes) : JSValue();
        return accessor && !accessor.isUndefined() ? uncheckedDowncast<GetterSetter>(accessor) : nullptr;
    }

    static void willChange(JSObject* object, PropertyName name)
    {
        VM& vm = object->vm();
        unsigned attributes;
        if (GetterSetter* accessor = accessorOfConstant(object, name, attributes)) {
            object->putDirectNonIndexAccessor(vm, name, accessor, attributes);
            asObject(object->getDirect(vm, constantsName(vm)))->putDirect(vm, name, jsUndefined());
        } else if (isHidden(object, name))
            vm.invalidateStructureChainIntegrity(VM::StructureChainIntegrityEvent::Add, object, name.uid());
    }

    static bool put(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, JSValue value, PutPropertySlot& slot)
    {
        unsigned attributes;
        if (GetterSetter* accessor = accessorOfConstant(asObject(cell), name, attributes)) {
            slot.disableCaching();
            return accessor->callSetter(globalObject, slot.thisValue(), value, slot.isStrictMode());
        }
        willChange(asObject(cell), name);
        return Base::put(cell, globalObject, name, value, slot);
    }

    static bool defineOwnProperty(JSObject* object, JSGlobalObject* globalObject, PropertyName name, const PropertyDescriptor& descriptor, bool shouldThrow)
    {
        willChange(object, name);
        return Base::defineOwnProperty(object, globalObject, name, descriptor, shouldThrow);
    }

    static bool getOwnPropertySlot(JSObject* object, JSGlobalObject* globalObject, PropertyName name, PropertySlot& slot)
    {
        if (slot.internalMethodType() == PropertySlot::InternalMethodType::GetOwnProperty) {
            unsigned attributes;
            if (GetterSetter* accessor = accessorOfConstant(object, name, attributes)) {
                slot.setGetterSlot(object, attributes, accessor);
                return true;
            }
        }
        if (isHidden(object, name)) [[unlikely]] {
            slot.disableCaching();
            return false;
        }
        return Base::getOwnPropertySlot(object, globalObject, name, slot);
    }

    static bool deleteProperty(JSCell* cell, JSGlobalObject* globalObject, PropertyName name, DeletePropertySlot& slot)
    {
        JSObject* object = asObject(cell);
        VM& vm = globalObject->vm();
        willChange(object, name);
        bool hadStaticProperties = !object->staticPropertiesReified();
        bool isDeleted = Base::deleteProperty(cell, globalObject, name, slot);
        if (!hadStaticProperties || !object->staticPropertiesReified())
            return isDeleted;
        for (const ClassInfo* info = object->classInfo(); info; info = info->parentClass) {
            if (!info->staticPropHashTable)
                continue;
            for (auto& entry : *info->staticPropHashTable) {
                auto other = Identifier::fromString(vm, entry.m_key);
                DeletePropertySlot otherSlot;
                if (isHidden(object, other))
                    Base::deleteProperty(cell, globalObject, other, otherSlot);
            }
        }
        return isDeleted;
    }

    static void getOwnPropertyNames(JSObject* object, JSGlobalObject* globalObject, PropertyNameArrayBuilder& names, DontEnumPropertiesMode mode)
    {
        VM& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        PropertyNameArrayBuilder all(vm, names.propertyNameMode(), names.privateSymbolMode());
        object->getOwnIndexedPropertyNames(globalObject, all, mode);
        object->getOwnNonIndexPropertyNames(globalObject, all, mode);
        RETURN_IF_EXCEPTION(scope, );
        for (const Identifier& name : all) {
            if (!isHidden(object, name))
                names.add(name);
        }
    }
};
const ClassInfo RealmGlobal::s_info = { "GlobalObject"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RealmGlobal) };

bool isDesktopRealm(JSGlobalObject* globalObject)
{
    return globalObject->globalObjectMethodTable()->promiseRejectionTracker == &trackRejection;
}

extern "C" bool Bun__isDesktopRealm(JSGlobalObject* globalObject)
{
    return isDesktopRealm(globalObject);
}

// Null before the realm is sealed and after it is disposed.
static JSObject* hooksOf(JSGlobalObject* realm)
{
    VM& vm = realm->vm();
    JSValue hooks = realm->getDirect(vm, WebCore::builtinNames(vm).hostPrivateName());
    return hooks ? hooks.getObject() : nullptr;
}

static JSValue callHook(JSGlobalObject* realm, ASCIILiteral name, JSValue first, JSValue second)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* hooks = hooksOf(realm);
    if (!hooks) {
        throwTypeError(realm, scope, "The page was unloaded"_s);
        return {};
    }
    JSValue hook = hooks->getDirect(vm, Identifier::fromString(vm, name));
    if (!hook)
        return jsUndefined();
    MarkedArgumentBuffer arguments;
    arguments.append(first);
    arguments.append(second);
    RELEASE_AND_RETURN(scope, call(realm, hook, getCallData(hook), jsUndefined(), arguments));
}

JSValue callDesktopRealmHook(JSGlobalObject* realm, ASCIILiteral name, JSValue first, JSValue second)
{
    return callHook(realm, name, first, second);
}

static void reportToPage(JSGlobalObject* realm, JSValue error, JSValue promise)
{
    if (!hooksOf(realm))
        return;
    VM& vm = realm->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    callHook(realm, "error"_s, error, promise);
    if (auto* exception = scope.exception(); exception && scope.tryClearException())
        Zig::GlobalObject::reportUncaughtExceptionAtEventLoop(defaultGlobalObject(vm), exception);
}

bool desktopRealmHandlesUncaughtException(JSGlobalObject* globalObject, JSValue error)
{
    if (!isDesktopRealm(globalObject)) [[likely]]
        return false;
    if (auto* exception = dynamicDowncast<JSC::Exception>(error))
        error = exception->value();
    reportToPage(globalObject, error, jsUndefined());
    return true;
}

JSValue desktopRealmOriginOf(JSGlobalObject* globalObject, const String& href)
{
    if (!isDesktopRealm(globalObject) || !hooksOf(globalObject)) [[likely]]
        return {};
    return callHook(globalObject, "origin"_s, jsString(globalObject->vm(), href), jsUndefined());
}

static void trackRejection(JSGlobalObject* realm, JSPromise* promise, JSPromiseRejectionOperation operation)
{
    JSObject* hooks = hooksOf(realm);
    if (!hooks)
        return;
    VM& vm = realm->vm();
    if (operation == JSPromiseRejectionOperation::Handle) {
        auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
        callHook(realm, "handled"_s, promise, promise->result());
        (void)scope.tryClearException();
        return;
    }
    auto* rejected = uncheckedDowncast<JSArray>(hooks->getDirect(vm, Identifier::fromString(vm, "rejected"_s)));
    bool isFirst = !rejected->length();
    rejected->putDirectIndex(realm, rejected->length(), promise);
    if (!isFirst)
        return;
    uncheckedDowncast<Zig::GlobalObject>(realm)->scriptExecutionContext()->postTask([protectedRealm = Strong<JSGlobalObject>(vm, realm), protectedRejected = Strong<JSArray>(vm, rejected)](WebCore::ScriptExecutionContext&) {
        auto* realm = protectedRealm.get();
        auto* rejected = protectedRejected.get();
        MarkedArgumentBuffer promises;
        for (unsigned i = 0; i < rejected->length(); i++)
            promises.append(rejected->getIndexQuickly(i));
        rejected->setLength(realm, 0);
        for (unsigned i = 0; i < promises.size(); i++) {
            auto* promise = uncheckedDowncast<JSPromise>(promises.at(i));
            if (!promise->isHandled())
                reportToPage(realm, promise->result(), promise);
        }
    });
}

static void reportRefusedEval(JSGlobalObject* realm, const String& source)
{
    if (!hooksOf(realm))
        return;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(realm->vm());
    callHook(realm, "refusedEval"_s, jsString(realm->vm(), source.isNull() ? emptyString() : source), jsUndefined());
    (void)scope.tryClearException();
}

static String codeOfTrustedScript(JSGlobalObject* realm, JSValue value)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    JSValue code = callHook(realm, "codeForEval"_s, value, jsUndefined());
    RETURN_IF_EXCEPTION(scope, {});
    if (!code.isString())
        return {};
    RELEASE_AND_RETURN(scope, code.toWTFString(realm));
}

static bool mayCompileString(JSGlobalObject* realm, CompilationType type, String code, const ArgList& arguments)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    JSValue given = jsUndefined();
    if (type == CompilationType::Function) {
        given = constructArray(realm, static_cast<ArrayAllocationProfile*>(nullptr), arguments);
        RETURN_IF_EXCEPTION(scope, false);
    }
    JSValue result = callHook(realm, "mayCompile"_s, jsString(realm->vm(), code), given);
    RETURN_IF_EXCEPTION(scope, false);
    return result.isTrue();
}

// `$cloner` is on the prototypes of the interfaces: false, or a function.
JSObject* desktopRealmSerialize(JSGlobalObject* realm, JSObject* object, bool isForStorage)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto& name = WebCore::builtinNames(vm).clonerPrivateName();
    for (JSValue prototype = object->getPrototypeDirect(); prototype.isObject(); prototype = asObject(prototype)->getPrototypeDirect()) {
        JSValue cloner = asObject(prototype)->getDirect(vm, name);
        if (!cloner)
            continue;
        if (!cloner.isCallable()) {
            WebCore::throwDataCloneError(*realm, scope);
            return nullptr;
        }
        MarkedArgumentBuffer arguments;
        arguments.append(object);
        arguments.append(jsBoolean(isForStorage));
        JSValue serialized = call(realm, cloner, getCallData(cloner), jsUndefined(), arguments);
        RETURN_IF_EXCEPTION(scope, nullptr);
        return serialized.getObject();
    }
    return nullptr;
}

extern "C" SYSV_ABI bool JSDOMFile__hasInstance(EncodedJSValue, JSGlobalObject*, EncodedJSValue);

void desktopRealmAdoptFile(JSGlobalObject* realm, JSValue blob)
{
    if (!isDesktopRealm(realm) || !blob || !blob.isObject() || !JSDOMFile__hasInstance(JSValue::encode(jsUndefined()), realm, JSValue::encode(blob)))
        return;
    VM& vm = realm->vm();
    JSObject* hooks = hooksOf(realm);
    JSValue prototype = hooks ? hooks->getDirect(vm, Identifier::fromString(vm, "filePrototype"_s)) : JSValue();
    if (prototype)
        asObject(blob)->setPrototypeDirect(vm, prototype);
}

JSValue desktopRealmDeserialize(JSGlobalObject* realm, JSObject* serialized)
{
    if (!isDesktopRealm(realm) || !hooksOf(realm))
        return serialized;
    return callHook(realm, "deserialize"_s, serialized, jsUndefined());
}

static Identifier resolveModule(JSGlobalObject* realm, JSModuleLoader*, JSValue key, JSValue referrer, RefPtr<ScriptFetcher>, bool useImportMap)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    if (!useImportMap)
        RELEASE_AND_RETURN(scope, key.toPropertyKey(realm));
    JSValue resolved = callHook(realm, "resolve"_s, key, referrer);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, resolved.toPropertyKey(realm));
}

static JSPromise* fetchModule(JSGlobalObject* realm, JSModuleLoader*, JSValue key, const String&, RefPtr<ScriptFetchParameters> parameters, RefPtr<ScriptFetcher>)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (realm->globalObjectMethodTable()->moduleHost) {
        String path = key.toWTFString(realm);
        if (scope.exception()) [[unlikely]]
            return JSPromise::rejectedPromiseWithCaughtException(realm, scope);
        if (auto* compiled = compiledModuleSource(uncheckedDowncast<Zig::GlobalObject>(realm), path, nullptr))
            return compiled;
    }
    String type = emptyString();
    if (parameters && parameters->type() == ScriptFetchParameters::Type::JSON)
        type = "json"_s;
    else if (parameters && parameters->type() == ScriptFetchParameters::Type::WebAssembly)
        type = "webassembly"_s;
    else if (parameters && parameters->type() == ScriptFetchParameters::Type::HostDefined)
        type = parameters->hostDefinedImportType();
    JSValue fetched = callHook(realm, "fetch"_s, key, jsString(vm, type));
    if (scope.exception()) [[unlikely]]
        return JSPromise::rejectedPromiseWithCaughtException(realm, scope);
    return uncheckedDowncast<JSPromise>(fetched);
}

static JSPromise* importModuleFrom(JSGlobalObject* realm, JSModuleLoader* loader, JSString* specifierValue, RefPtr<ScriptFetchParameters> parameters, const SourceOrigin& origin, bool deferred)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    String specifier = specifierValue->value(realm);
    if (scope.exception()) [[unlikely]]
        return JSPromise::rejectedPromiseWithCaughtException(realm, scope);
    auto referrer = Identifier::fromString(vm, origin.url().string().isNull() ? emptyString() : origin.url().string());
    auto* result = loader->requestImportModule(realm, Identifier::fromString(vm, specifier), referrer, WTF::move(parameters), nullptr, deferred, loader->asyncEvaluationOrderForKey(referrer));
    if (scope.exception()) [[unlikely]]
        return JSPromise::rejectedPromiseWithCaughtException(realm, scope);
    return result;
}

static JSObject* createImportMeta(JSGlobalObject* realm, JSModuleLoader*, JSValue key, JSModuleRecord*, RefPtr<ScriptFetcher>)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    JSValue meta = callHook(realm, "importMeta"_s, key, jsUndefined());
    RETURN_IF_EXCEPTION(scope, nullptr);
    return asObject(meta);
}

#if ENABLE(WEBASSEMBLY)
// Empty if the promise has been rejected.
static JSValue nativeResponseFor(JSGlobalObject* realm, JSPromise* promise, JSValue source)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue response = callHook(realm, "nativeResponse"_s, source, jsUndefined());
    if (!scope.exception()) [[likely]]
        return response;
    promise->rejectWithCaughtException(vm, scope);
    return {};
}

static void compileStreaming(JSGlobalObject* realm, JSPromise* promise, JSValue source, std::optional<WebAssemblyCompileOptions>&& options)
{
    if (JSValue response = nativeResponseFor(realm, promise, source))
        Zig::GlobalObject::compileStreaming(realm, promise, response, WTF::move(options));
}

static void instantiateStreaming(JSGlobalObject* realm, JSPromise* promise, JSValue source, JSObject* imports, std::optional<WebAssemblyCompileOptions>&& options)
{
    if (JSValue response = nativeResponseFor(realm, promise, source))
        Zig::GlobalObject::instantiateStreaming(realm, promise, response, imports, WTF::move(options));
}
#endif

// With a module host, the realm gets an instance of the compiled program.
template<bool runsCompiledProgram>
static const GlobalObjectMethodTable& desktopRealmMethodTable()
{
    static const GlobalObjectMethodTable table = [] {
        GlobalObjectMethodTable table = Zig::GlobalObject::globalObjectMethodTable();
        table.moduleLoaderImportModule = &importModuleFrom;
        table.moduleLoaderResolve = &resolveModule;
        table.moduleLoaderFetch = &fetchModule;
        table.moduleLoaderCreateImportMetaProperties = &createImportMeta;
        table.moduleLoaderEvaluate = nullptr;
        table.promiseRejectionTracker = &trackRejection;
        table.reportViolationForUnsafeEval = &reportRefusedEval;
        table.codeForEval = &codeOfTrustedScript;
        table.canCompileStrings = &mayCompileString;
#if ENABLE(WEBASSEMBLY)
        table.compileStreaming = &compileStreaming;
        table.instantiateStreaming = &instantiateStreaming;
#endif
        if (runsCompiledProgram)
            table.moduleHost = &compiledModuleHost;
        return table;
    }();
    return table;
}

// (windowProxy?): the `globalThis` of the realm.
JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateDesktopRealm, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool runsCompiledProgram = vm.hasCompiledCode() && compiledProgramRunsInSeveralRealmsAtOnce();
    Zig::GlobalObject* realm;
    {
        DeferGC deferGC(vm);
        auto& methodTable = runsCompiledProgram ? desktopRealmMethodTable<true>() : desktopRealmMethodTable<false>();
        realm = Zig::GlobalObject::create(vm, RealmGlobal::createStructure(vm), WebCore::ScriptExecutionContext::generateIdentifier(), &methodTable);
        if (auto* proxy = dynamicDowncast<JSGlobalProxy>(callFrame->argument(0))) {
            proxy->setTarget(vm, realm);
            realm->addressOfGlobalThis()->set(vm, realm, proxy);
        }
        realm->setConsole(realm);
#if ENABLE(AOT)
        if (runsCompiledProgram) {
            AOT::acceptForeignBinaryData(globalObject);
            AOT::acceptForeignBinaryData(realm);
        }
#endif
        defaultGlobalObject(vm)->addDerivedRealm(realm);
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(BUN_REQUIRE_INTERNAL_MODULE(realm, InternalDesktopElectronRealm, "bun:desktop/electron")));
}

class NamesWithout final : public ImmutablePropertyNames::OutsideNames {
public:
    NamesWithout(ImmutablePropertyNames& names, UniquedStringImpl* released)
        : m_names(names)
        , m_released(released)
    {
    }

    bool contains(UniquedStringImpl* uid) const final { return uid != m_released && m_names->contains(uid); }
    bool refusesWrite(UniquedStringImpl* uid) const final { return uid != m_released && m_names->refusesWrite(uid); }
    bool refusalDependsOnWriter(UniquedStringImpl* uid) const final { return m_names->refusalDependsOnWriter(uid); }
    String storeErrorMessage(UniquedStringImpl* uid) const final { return m_names->storeErrorMessage(uid); }
    String deleteErrorMessage(UniquedStringImpl* uid) const final { return m_names->deleteErrorMessage(uid); }
    String setPrototypeErrorMessage() const final { return m_names->setPrototypeErrorMessage(); }
    bool throwsInSloppyMode() const final { return m_names->throwsInSloppyMode(); }
    bool throwsFromReflect() const final { return m_names->throwsFromReflect(); }
    void willWrite(UniquedStringImpl* uid) const final
    {
        if (uid != m_released)
            m_names->willWrite(uid);
    }

private:
    const Ref<ImmutablePropertyNames> m_names;
    const RefPtr<UniquedStringImpl> m_released;
};

// Compiled built-in modules go on finding it: the instance remembers the objects that it has locked.
static void removeLockedGlobal(JSGlobalObject* realm, PropertyName name)
{
    VM& vm = realm->vm();
    PropertySlot slot(realm, PropertySlot::InternalMethodType::GetOwnProperty);
    JSGlobalObject::getOwnPropertySlot(realm, realm, name, slot);
    if (!isValidOffset(realm->getDirectOffset(vm, name)))
        return;
    realm->convertToUncacheableDictionary(vm);
    PropertyOffset offset = realm->structure()->removePropertyWithoutTransition(vm, name, [](const GCSafeConcurrentJSLocker&, PropertyOffset, PropertyOffset) {});
    realm->locationForOffset(offset)->clear();
    realm->flattenDictionaryObject(vm);
    auto& names = *realm->structure()->listedImmutablePropertyNames();
    realm->structure()->rareData()->setImmutablePropertyNames(ImmutablePropertyNames::create({}, names.parts(), {}, adoptRef(*new NamesWithout(names, name.uid()))));
    vm.invalidateStructureChainIntegrity(VM::StructureChainIntegrityEvent::Remove, realm, name.uid());
}

// (hooks, names): `names` are the globals to remove, even those that script cannot delete.
JSC_DEFINE_HOST_FUNCTION(jsFunctionSealDesktopRealm, (JSGlobalObject * realm, CallFrame* callFrame))
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    ASSERT(isDesktopRealm(realm));
    realm->putDirect(vm, WebCore::builtinNames(vm).hostPrivateName(), callFrame->uncheckedArgument(0));
    auto* names = uncheckedDowncast<JSArray>(callFrame->uncheckedArgument(1));
    VM::DeletePropertyModeScope deleteMode(vm, VM::DeletePropertyMode::IgnoreConfigurable);
    for (unsigned i = 0; i < names->length(); i++) {
        auto name = names->getIndexQuickly(i).toPropertyKey(realm);
        RETURN_IF_EXCEPTION(scope, {});
        bool isLocked = realm->structure()->isImmutablePropertyForReader(name.impl());
        if (isLocked)
            removeLockedGlobal(realm, name);
        RETURN_IF_EXCEPTION(scope, {});
        if (isInStaticTable(realm, name))
            realm->putDirect(vm, name, jsUndefined(), RealmGlobal::hiddenAttributes);
        else if (!isLocked)
            JSCell::deleteProperty(realm, realm, name);
        RETURN_IF_EXCEPTION(scope, {});
    }
    return JSValue::encode(jsUndefined());
}

// (isReachable): whether the scripts of other documents may have its promises.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDisposeDesktopRealm, (JSGlobalObject * realm, CallFrame* callFrame))
{
    VM& vm = realm->vm();
    ASSERT(isDesktopRealm(realm));
    realm->putDirect(vm, WebCore::builtinNames(vm).hostPrivateName(), jsUndefined());
    uncheckedDowncast<Zig::GlobalObject>(realm)->scriptExecutionContext()->prepareForDestruction();
    realm->setMicrotaskRunnability(callFrame->argument(0).isTrue() ? QueuedTaskResult::Executed : QueuedTaskResult::Discard);
    return JSValue::encode(jsUndefined());
}

// (enabled, isForWebAssembly): returns what it was.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmSetEvalEnabled, (JSGlobalObject * realm, CallFrame* callFrame))
{
    if (callFrame->argument(1).isTrue()) {
        realm->setWebAssemblyEnabled(callFrame->uncheckedArgument(0).isTrue(), "Refused to compile WebAssembly because 'wasm-unsafe-eval' is not an allowed source of script in the Content Security Policy"_s);
        return JSValue::encode(jsUndefined());
    }
    bool wasEnabled = realm->evalEnabled();
    realm->setEvalEnabled(callFrame->uncheckedArgument(0).isTrue() && codeGenerationFromStrings() == CodeGenerationFromStrings::Allowed, "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the Content Security Policy"_s);
    return JSValue::encode(jsBoolean(wasEnabled));
}

static SourceCode sourceCodeFrom(JSGlobalObject* realm, CallFrame* callFrame, SourceProviderSourceType type)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    String source = callFrame->uncheckedArgument(0).toWTFString(realm);
    RETURN_IF_EXCEPTION(scope, {});
    String url = callFrame->uncheckedArgument(1).toWTFString(realm);
    RETURN_IF_EXCEPTION(scope, {});
    String base = callFrame->argument(3).isString() ? callFrame->uncheckedArgument(3).toWTFString(realm) : url;
    RETURN_IF_EXCEPTION(scope, {});
    int line = callFrame->argument(4).isInt32() ? callFrame->uncheckedArgument(4).asInt32() : 0;
    int column = callFrame->argument(5).isInt32() ? callFrame->uncheckedArgument(5).asInt32() : 0;
    TextPosition start { OrdinalNumber::fromZeroBasedInt(line), OrdinalNumber::fromZeroBasedInt(column) };
    SourceOrigin origin { URL({}, base) };
    return SourceCode(StringSourceProvider::create(source, origin, WTF::move(url), SourceTaintedOrigin::Untainted, start, type));
}

// (source, url, unused, base?, line?, column?): `base` is what `import()` resolves against.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmEvaluate, (JSGlobalObject * realm, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    SourceCode source = sourceCodeFrom(realm, callFrame, SourceProviderSourceType::Program);
    RETURN_IF_EXCEPTION(scope, {});
    NakedPtr<JSC::Exception> exception;
    JSValue result = evaluate(realm, source, realm->globalThis(), exception);
    if (exception) {
        scope.throwException(realm, exception.get());
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// (url)
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmImport, (JSGlobalObject * realm, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    JSString* url = callFrame->uncheckedArgument(0).toString(realm);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(importModuleFrom(realm, realm->moduleLoader(), url, nullptr, SourceOrigin(), false)));
}

// (key): fetches it and what it imports.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmLoadModule, (JSGlobalObject * realm, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    auto key = callFrame->uncheckedArgument(0).toPropertyKey(realm);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(loadModule(realm, key, RefPtr<ScriptFetchParameters>(), nullptr)));
}

// (key): of one that was loaded.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmEvaluateModule, (JSGlobalObject * realm, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    auto key = callFrame->uncheckedArgument(0).toPropertyKey(realm);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSValue::encode(linkAndEvaluateModule(realm, key, nullptr)));
}

// (source, url, isJSON, base?, line?, column?): what the promise of the `fetch` hook is fulfilled with.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmModuleSource, (JSGlobalObject * realm, CallFrame* callFrame))
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    SourceCode source = sourceCodeFrom(realm, callFrame, callFrame->uncheckedArgument(2).isTrue() ? SourceProviderSourceType::JSON : SourceProviderSourceType::Module);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(JSSourceCode::create(vm, WTF::move(source)));
}

static constexpr unsigned lazyAttributes = static_cast<unsigned>(PropertyAttribute::DontEnum);

static JSC_DECLARE_CUSTOM_GETTER(getLazily);
static JSC_DECLARE_CUSTOM_SETTER(replaceLazy);

JSC_DEFINE_CUSTOM_GETTER(getLazily, (JSGlobalObject * globalObject, EncodedJSValue holderValue, PropertyName name))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* holder = asObject(JSValue::decode(holderValue));
    JSValue load = holder->getDirect(vm, WebCore::builtinNames(vm).lazyLoaderPrivateName());
    MarkedArgumentBuffer arguments;
    arguments.append(identifierToJSValue(vm, Identifier::fromUid(vm, name.uid())));
    JSValue value = call(globalObject, load, getCallData(load), jsUndefined(), arguments);
    RETURN_IF_EXCEPTION(scope, {});
    replaceLazyProperty(vm, holder, name, value, lazyAttributes);
    return JSValue::encode(value);
}

JSC_DEFINE_CUSTOM_SETTER(replaceLazy, (JSGlobalObject * globalObject, EncodedJSValue holderValue, EncodedJSValue value, PropertyName name))
{
    return asObject(JSValue::decode(holderValue))->putDirect(globalObject->vm(), name, JSValue::decode(value), lazyAttributes);
}

// (names, load): data properties of the global object, whose values are `load(name)`.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmDefineLazily, (JSGlobalObject * realm, CallFrame* callFrame))
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    realm->putDirect(vm, WebCore::builtinNames(vm).lazyLoaderPrivateName(), callFrame->uncheckedArgument(1));
    auto* names = uncheckedDowncast<JSArray>(callFrame->uncheckedArgument(0));
    auto* accessor = CustomGetterSetter::create(vm, getLazily, replaceLazy);
    ChangesInPlace inPlace(vm, realm);
    for (unsigned i = 0; i < names->length(); i++) {
        auto name = names->getIndexQuickly(i).toPropertyKey(realm);
        RETURN_IF_EXCEPTION(scope, {});
        realm->putDirectCustomAccessor(vm, name, accessor, lazyAttributes | PropertyAttribute::CustomValue);
    }
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_GETTER(getConstant, (JSGlobalObject * globalObject, EncodedJSValue holderValue, PropertyName name))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* realm = uncheckedDowncast<JSGlobalObject>(asObject(JSValue::decode(holderValue)));
    unsigned attributes;
    JSValue value = RealmGlobal::accessorOfConstant(realm, name, attributes)->callGetter(globalObject, realm->globalThis());
    RETURN_IF_EXCEPTION(scope, {});
    if (RealmGlobal::accessorOfConstant(realm, name, attributes))
        replaceLazyProperty(vm, realm, name, value, PropertyAttribute::ReadOnly | (attributes & PropertyAttribute::DontEnum));
    return JSValue::encode(value);
}

// (window, names): accessors that return the same value until this is called again.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmCacheAccessors, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSGlobalObject* realm = uncheckedDowncast<JSGlobalProxy>(callFrame->uncheckedArgument(0))->target();
    JSValue constants = realm->getDirect(vm, RealmGlobal::constantsName(vm));
    if (!constants) {
        constants = constructEmptyObject(vm, realm->nullPrototypeObjectStructure());
        asObject(constants)->convertToDictionary(vm);
        realm->putDirect(vm, RealmGlobal::constantsName(vm), constants);
    }
    auto* names = uncheckedDowncast<JSArray>(callFrame->uncheckedArgument(1));
    auto* lazy = CustomGetterSetter::create(vm, getConstant, nullptr);
    ChangesInPlace inPlace(vm, realm);
    for (unsigned i = 0; i < names->length(); i++) {
        auto name = names->getIndexQuickly(i).toPropertyKey(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        unsigned attributes = 0;
        if (!RealmGlobal::accessorOfConstant(realm, name, attributes)) {
            JSValue accessor = realm->getDirect(vm, name, attributes);
            if (!accessor || !(attributes & PropertyAttribute::Accessor))
                continue;
            asObject(constants)->putDirectNonIndexAccessor(vm, name, uncheckedDowncast<GetterSetter>(accessor), attributes);
        }
        realm->putDirectCustomAccessor(vm, name, lazy, PropertyAttribute::CustomValue | (attributes & PropertyAttribute::DontEnum));
    }
    return JSValue::encode(jsUndefined());
}

static const Identifier& nativesOfPageName(VM& vm) { return WebCore::builtinNames(vm).originalLinePrivateName(); }

JSC_DEFINE_CUSTOM_GETTER(getNativeOfPage, (JSGlobalObject * globalObject, EncodedJSValue holderValue, PropertyName name))
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSObject* holder = asObject(JSValue::decode(holderValue));
    JSValue value = holder->getDirect(vm, nativesOfPageName(vm)).get(globalObject, name);
    RETURN_IF_EXCEPTION(scope, {});
    replaceLazyProperty(vm, holder, name, value, lazyAttributes);
    return JSValue::encode(value);
}

// (window, isOwn): the realm gets what `window` has now, but for the names in `isOwn`. What is lazy stays so.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmShareGlobals, (JSGlobalObject * realm, CallFrame* callFrame))
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSGlobalObject* page = uncheckedDowncast<JSGlobalProxy>(callFrame->uncheckedArgument(0))->target();
    JSObject* isOwn = asObject(callFrame->uncheckedArgument(1));
    auto& names = WebCore::builtinNames(vm);
    auto isShared = [&](PropertyName name) {
        if (name.isSymbol())
            return name == names.implPrivateName() || name == names.lazyLoaderPrivateName() || isUsedByLazyProperties(vm, name);
        unsigned attributes = 0;
        realm->getDirectOffset(vm, name, attributes);
        return !(attributes & PropertyAttribute::DontDelete) && !isOwn->getDirect(vm, name) && !realm->structure()->isImmutablePropertyForReader(name.uid());
    };

    Vector<PropertyTableEntry, 256> entries;
    page->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) {
        entries.append(entry);
        return true;
    });
    ChangesInPlace inPlace(vm, realm);
    for (auto& entry : entries) {
        PropertyName name(entry.key());
        if (!isShared(name))
            continue;
        JSValue value = page->getDirect(entry.offset());
        unsigned attributes;
        if (GetterSetter* accessor = RealmGlobal::accessorOfConstant(page, name, attributes))
            realm->putDirectNonIndexAccessor(vm, name, accessor, attributes);
        else if (entry.attributes() & PropertyAttribute::Accessor)
            realm->putDirectNonIndexAccessor(vm, name, uncheckedDowncast<GetterSetter>(value), entry.attributes());
        else if (entry.attributes() & PropertyAttribute::CustomAccessorOrValue)
            realm->putDirectCustomAccessor(vm, name, value, entry.attributes());
        else
            realm->putDirect(vm, name, value, entry.attributes());
    }

    if (page->staticPropertiesReified())
        return JSValue::encode(jsUndefined());
    JSValue natives = page->get(page, names.nativesPrivateName());
    RETURN_IF_EXCEPTION(scope, {});
    realm->putDirect(vm, nativesOfPageName(vm), natives);
    auto* accessor = CustomGetterSetter::create(vm, getNativeOfPage, replaceLazy);
    for (auto& entry : *Zig::GlobalObject::info()->staticPropHashTable) {
        auto name = Identifier::fromString(vm, entry.m_key);
        if (entry.attributes() & PropertyAttribute::BuiltinOrFunctionOrLazyProperty && !page->getDirect(vm, name) && isShared(name))
            realm->putDirectCustomAccessor(vm, name, accessor, lazyAttributes | PropertyAttribute::CustomValue);
    }
    return JSValue::encode(jsUndefined());
}

// (value): [url, line, column] if it is what was thrown last.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmWhereThrown, (JSGlobalObject * realm, CallFrame* callFrame))
{
    VM& vm = realm->vm();
    auto* exception = vm.lastException();
    if (!exception || exception->value() != callFrame->uncheckedArgument(0))
        return JSValue::encode(jsUndefined());
    for (auto& frame : exception->stack()) {
        if (!frame.hasLineAndColumnInfo())
            continue;
        String url = frame.sourceURL(vm);
        if (!URL({}, url).isValid() || url.startsWith("internal:"_s) || url.startsWith("node:"_s))
            continue;
        auto position = frame.computeLineAndColumn();
        MarkedArgumentBuffer parts;
        parts.append(jsString(vm, url));
        parts.append(jsNumber(position.line));
        parts.append(jsNumber(position.column));
        return JSValue::encode(constructArray(realm, static_cast<ArrayAllocationProfile*>(nullptr), parts));
    }
    return JSValue::encode(jsUndefined());
}

// (isPaused): its microtasks wait.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmSetPaused, (JSGlobalObject * realm, CallFrame* callFrame))
{
    if (hooksOf(realm))
        realm->setMicrotaskRunnability(callFrame->uncheckedArgument(0).isTrue() ? QueuedTaskResult::Suspended : QueuedTaskResult::Executed);
    return JSValue::encode(jsUndefined());
}

// (value): undefined unless it is a ReadableStream.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmIsDisturbed, (JSGlobalObject*, CallFrame* callFrame))
{
    auto* stream = dynamicDowncast<WebCore::JSReadableStream>(callFrame->uncheckedArgument(0));
    return JSValue::encode(stream ? jsBoolean(stream->m_disturbed) : jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmHasLocalMessages, (JSGlobalObject*, CallFrame*))
{
    return JSValue::encode(jsBoolean(WebCore::MessagePortPipe::hasLocalDrain()));
}

// (object): undefined if it takes more than that.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmCopyPlainData, (JSGlobalObject * realm, CallFrame* callFrame))
{
    JSValue copy = WebCore::SerializedScriptValue::tryCopyPlainData(*realm, callFrame->uncheckedArgument(0));
    return JSValue::encode(copy ? copy : jsUndefined());
}

// (isOn): whether the `mayCompile` hook is asked about each string.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmRequireTrustedScripts, (JSGlobalObject * realm, CallFrame* callFrame))
{
    realm->setTrustedTypesEnforcement(callFrame->uncheckedArgument(0).isTrue() ? TrustedTypesEnforcement::Enforced : TrustedTypesEnforcement::None);
    return JSValue::encode(jsUndefined());
}

// (path): whether the file was compiled into this executable.
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmIsCompiled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    String path = callFrame->uncheckedArgument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsBoolean(isCompiledModule(path)));
}

// (path, synchronously)
JSC_DEFINE_HOST_FUNCTION(jsFunctionDesktopRealmRunCompiled, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* realm = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    String path = callFrame->uncheckedArgument(0).toWTFString(realm);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue result = callFrame->uncheckedArgument(1).isTrue() ? loadCompiledModuleNamespace(realm, path) : JSValue(importCompiledModule(realm, path, nullptr, -1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result ? result : jsUndefined());
}

} // namespace Bun
