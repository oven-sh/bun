#include "root.h"

#include "DesktopRealm.h"
#include "Bindgen/JSInterface.h"

#include "BunClientData.h"
#include "BunCompiledModules.h"
#include "ErrorStackTrace.h"
#include "GeneratedBlob.h"
#include "InternalModuleRegistry.h"
#include "JSDOMExceptionHandling.h"
#include "CodeGenerationFromStrings.h"
#include "MessagePortPipe.h"
#include "RealmBridge.h"
#include "RemovableFeatures.h"
#include "ScriptExecutionContext.h"
#include "SerializedScriptValue.h"
#include "IsolatedWorld.h"
#include "WebGlobalObject.h"
#include "streams/JSReadableStream.h"
#include "webcore/AddEventListenerOptions.h"
#include "webcore/ErrorEvent.h"
#include "webcore/EventListener.h"
#include "webcore/EventNames.h"
#include "webcore/Worker.h"

#include <JavaScriptCore/AOTRealmStartup.h>
#include <JavaScriptCore/CodeBlock.h>
#include <JavaScriptCore/Completion.h>
#include <JavaScriptCore/DeferGCInlines.h>
#include <JavaScriptCore/FunctionConstructor.h>
#include <JavaScriptCore/GlobalObjectMethodTable.h>
#include <JavaScriptCore/JSGlobalProxy.h>
#include <JavaScriptCore/JSModuleLoader.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSNativeStdFunction.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSWithScope.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/ScriptFetchParameters.h>
#include <JavaScriptCore/SourceProvider.h>
#include <JavaScriptCore/StackVisitor.h>
#include <JavaScriptCore/WebAssemblyCompileOptions.h>

namespace Bun {

using namespace JSC;

static void trackRejection(JSGlobalObject*, JSPromise*, JSPromiseRejectionOperation);

bool isDesktopRealm(JSGlobalObject* globalObject)
{
    return globalObject->globalObjectMethodTable()->promiseRejectionTracker == &trackRejection;
}

extern "C" bool Bun__isDesktopRealm(JSGlobalObject* globalObject)
{
    return isDesktopRealm(globalObject);
}

extern "C" bool Bun__DesktopRealm__isOfPage(EncodedJSValue value)
{
    JSObject* object = JSValue::decode(value).getObject();
    auto* realm = object ? object->structure()->realm() : nullptr;
    return object && (!realm || isDesktopRealm(realm));
}

bool desktopRealmReifyMembersOfWeb(const ClassInfo* classInfo, std::span<const HashTableValue> values, JSObject& object)
{
    static constexpr std::pair<ASCIILiteral, ASCIILiteral> membersOfBun[] = {
        { "Blob"_s, "delete exists formData image json lastModified name stat unlink write writer"_s },
        { "Crypto"_s, "timingSafeEqual"_s },
        { "ReadableStream"_s, "blob bytes json text"_s },
        { "TextDecoder"_s, ""_s },
        { "URLSearchParams"_s, "length toJSON"_s },
    };
    auto* found = std::ranges::find(membersOfBun, classInfo->className, &std::pair<ASCIILiteral, ASCIILiteral>::first);
    if (found == std::end(membersOfBun))
        return false;
    Vector<StringView, 16> ofBun;
    for (auto name : StringView(found->second).split(' '))
        ofBun.append(name);
    Vector<HashTableValue, 16> ofWeb;
    for (auto value : values) {
        if (ofBun.contains(StringView(value.m_key)))
            continue;
        value.m_attributes &= ~static_cast<unsigned>(PropertyAttribute::DontDelete);
        ofWeb.append(value);
    }
    reifyStaticProperties(object.vm(), classInfo, ofWeb.span(), object);
    return true;
}

// It has been set up, and not been disposed of.
static bool isRunning(JSGlobalObject* realm)
{
    return uncheckedDowncast<WebGlobalObject>(realm)->isRunning();
}

extern "C" void Bun__DOM__reportException(JSGlobalObject*, EncodedJSValue, EncodedJSValue thrown);
extern "C" void Bun__DOM__promiseWasRejected(JSGlobalObject*, EncodedJSValue promise, EncodedJSValue reason);
extern "C" void Bun__DOM__rejectionWasHandled(JSGlobalObject*, EncodedJSValue promise, EncodedJSValue reason);
extern "C" bool Bun__DOM__mayCompile(JSGlobalObject*, EncodedJSValue code, const EncodedJSValue* parts, size_t count, bool isFunction);
extern "C" EncodedJSValue Bun__DOM__textOfTrustedScript(JSGlobalObject*, EncodedJSValue);
extern "C" BunString Bun__Desktop__createObjectURL(JSGlobalObject*, void* blob);
extern "C" void Bun__Desktop__revokeObjectURL(JSGlobalObject*, const BunString*);
extern "C" BunString Bun__WebRealm__originOf(const BunString*);
extern "C" bool Bun__WebRealm__allowsEval(void* realm, const BunString* code);

static void* stateOf(JSGlobalObject* realm) { return uncheckedDowncast<WebGlobalObject>(realm)->realm(); }

static const StackFrame* innermostScript(VM& vm, const Vector<StackFrame>& stack)
{
    for (auto& frame : stack) {
        if (!frame.hasLineAndColumnInfo() || (frame.codeBlock() && !isDesktopRealm(frame.codeBlock()->globalObject())))
            continue;
        String url = Zig::sourceURL(vm, frame);
        if (URL({}, url).isValid() && !url.startsWith("internal:"_s) && !url.startsWith("node:"_s))
            return &frame;
    }
    return nullptr;
}

// `thrown` is an exception, the value that was thrown last, or empty for what is running.
static Vector<StackFrame> stackOf(JSGlobalObject* realm, JSValue thrown)
{
    VM& vm = realm->vm();
    Vector<StackFrame> now;
    if (!thrown)
        vm.interpreter.getStackTrace(realm, now, 0, 64);
    for (auto* exception : { thrown ? dynamicDowncast<JSC::Exception>(thrown) : nullptr, vm.lastException() }) {
        if (exception && thrown && (exception == thrown || exception->value() == thrown))
            return exception->stack();
    }
    return now;
}

// Returns the URL.
// A call is where the name of the function is, not where its arguments begin.
static unsigned lengthOfCalledName(const StackFrame& frame, unsigned column)
{
    if (!frame.codeBlock() || !frame.hasBytecodeIndex())
        return 0;
    unsigned end = frame.codeBlock()->expressionInfoForBytecodeIndex(frame.bytecodeIndex()).divot;
    auto source = frame.codeBlock()->source().provider()->source();
    if (end >= source.length() || source[end] != '(')
        return 0;
    unsigned length = 0;
    while (length < end && length + 1 < column && (isASCIIAlphanumeric(source[end - length - 1]) || source[end - length - 1] == '_' || source[end - length - 1] == '$'))
        length++;
    return length;
}

extern "C" BunString Bun__DesktopRealm__locate(JSGlobalObject* realm, EncodedJSValue thrown, uint32_t* lineAndColumn)
{
    auto stack = stackOf(realm, JSValue::decode(thrown));
    auto* frame = innermostScript(realm->vm(), stack);
    if (!frame)
        return BunStringEmpty;
    auto position = frame->computeLineAndColumn();
    lineAndColumn[0] = position.line;
    lineAndColumn[1] = position.column - lengthOfCalledName(*frame, position.column);
    return Bun::toStringRef(Zig::sourceURL(realm->vm(), *frame)).leak();
}

// What `import()` resolves against in the script that is running, if that is of this realm.
extern "C" BunString Bun__DesktopRealm__baseOfScript(JSGlobalObject* realm)
{
    auto stack = stackOf(realm, JSValue());
    auto* frame = innermostScript(realm->vm(), stack);
    auto* code = frame ? frame->codeBlock() : nullptr;
    if (!code || code->globalObject() != realm)
        return BunStringEmpty;
    return Bun::toStringRef(code->source().provider()->sourceOrigin().url().string()).leak();
}

static String fetchedFrom(VM& vm, const Vector<StackFrame>& stack)
{
    for (auto& frame : stack) {
        auto* code = frame.codeBlock();
        String url = code && isDesktopRealm(code->globalObject()) ? code->source().provider()->sourceURL() : String();
        if (!url.isEmpty() && !url.startsWith("internal:"_s) && !url.startsWith("node:"_s))
            return url;
    }
    return {};
}

// The scripts that have thrown it and that have made it. No script has a say in the answer.
extern "C" void Bun__DesktopRealm__scriptsBehind(JSGlobalObject* realm, EncodedJSValue thrown, EncodedJSValue value, BunString* thrower, BunString* maker)
{
    VM& vm = realm->vm();
    *thrower = Bun::toStringRef(fetchedFrom(vm, stackOf(realm, JSValue::decode(thrown)))).leak();
    if (auto* error = dynamicDowncast<ErrorInstance>(JSValue::decode(value)))
        *maker = Bun::toStringRef(error->stackTrace() && !error->isParseError() ? fetchedFrom(vm, *error->stackTrace()) : error->sourceURL()).leak();
}

static JSGlobalObject* desktopRealmOf(JSCell* cell)
{
    auto* realm = cell && cell->isObject() ? cell->structure()->realm() : nullptr;
    return realm && isDesktopRealm(realm) ? realm : nullptr;
}

static JSGlobalObject* desktopRealmOnStack(VM& vm)
{
    JSGlobalObject* realm = nullptr;
    StackVisitor::visit(vm.entryScope ? vm.topCallFrame : nullptr, vm, [&](StackVisitor& visitor) {
        auto* ofFrame = visitor->codeBlock() ? visitor->codeBlock()->globalObject() : nullptr;
#if ENABLE(AOT)
        if (visitor->isCompiledFrame())
            ofFrame = visitor->compiledFrame().globalObject();
#endif
        realm = ofFrame && isDesktopRealm(ofFrame) ? ofFrame : nullptr;
        return realm ? IterationStatus::Done : IterationStatus::Continue;
    });
    return realm;
}

static JSGlobalObject* desktopRealmThatThrew(JSC::Exception* exception)
{
    if (JSValue value = RealmBridge::originalOf(exception->value()); value.isObject())
        return desktopRealmOf(value.asCell());
    return exception->stack().isEmpty() ? desktopRealmOnStack(exception->vm()) : desktopRealmOf(exception->stack().first().callee());
}

static bool isStackOverflow(JSC::Exception* exception)
{
    auto* error = dynamicDowncast<ErrorInstance>(RealmBridge::originalOf(exception->value()));
    return error && error->isStackOverflowError();
}

extern "C" bool Bun__DesktopRealm__hasStackLeft(JSGlobalObject* realm)
{
    return static_cast<char*>(currentStackPointer()) - static_cast<char*>(realm->vm().softStackLimit()) >= static_cast<ptrdiff_t>(64 * KB);
}

bool desktopRealmHandlesUncaughtException(JSGlobalObject* globalObject, JSValue error)
{
    if (isFeatureRemoved(Feature::Desktop))
        return false;
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Desktop, Abort, bool)
    auto* exception = dynamicDowncast<JSC::Exception>(error);
    JSValue value = exception ? exception->value() : error;
    if (!isDesktopRealm(globalObject)) {
        if (!exception)
            return false;
        // A page has used up the stack, and then called the host.
        if (isStackOverflow(exception) && desktopRealmOnStack(globalObject->vm()))
            return true;
        globalObject = desktopRealmThatThrew(exception);
        if (!globalObject)
            return false;
        value = RealmBridge::originalOf(value);
    }
    if (isRunning(globalObject))
        Bun__DOM__reportException(globalObject, JSValue::encode(value), JSValue::encode(exception));
    return true;
    BUN_END_REMOVABLE_ENTRY_POINT
}

JSValue desktopRealmOriginOf(JSGlobalObject* globalObject, const String& href)
{
    if (!isDesktopRealm(globalObject)) [[likely]]
        return {};
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Desktop, Abort, JSValue)
    auto url = Bun::toString(href);
    return jsString(globalObject->vm(), Bun__WebRealm__originOf(&url).transferToWTFString());
    BUN_END_REMOVABLE_ENTRY_POINT
}

EncodedJSValue desktopRealmCreateObjectURL(JSGlobalObject* realm, JSValue given)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Desktop, Abort, EncodedJSValue)
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    auto* blob = dynamicDowncast<Bindgen::Generated::JSBlob>(given);
    if (!blob)
        return throwVMTypeError(realm, scope, "Failed to execute 'createObjectURL' on 'URL': Overload resolution failed."_s);
    return JSValue::encode(jsString(realm->vm(), Bun__Desktop__createObjectURL(realm, blob->wrapped()).transferToWTFString()));
    BUN_END_REMOVABLE_ENTRY_POINT
}

void desktopRealmRevokeObjectURL(JSGlobalObject* realm, const String& text)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Desktop, Abort, void)
    auto url = Bun::toString(text);
    Bun__Desktop__revokeObjectURL(realm, &url);
    BUN_END_REMOVABLE_ENTRY_POINT
}

// https://html.spec.whatwg.org/#outstanding-rejected-promises-weak-set
static const Identifier& outstandingName(VM& vm) { return WebCore::builtinNames(vm).selfPrivateName(); }

extern "C" bool Bun__DesktopRealm__isHandled(EncodedJSValue promise) { return uncheckedDowncast<JSPromise>(JSValue::decode(promise))->isHandled(); }

extern "C" void Bun__DesktopRealm__rememberRejection(JSGlobalObject* realm, EncodedJSValue promise)
{
    asObject(JSValue::decode(promise))->putDirect(realm->vm(), outstandingName(realm->vm()), jsUndefined());
}

extern "C" bool Bun__DesktopRealm__isParseError(EncodedJSValue value)
{
    auto* error = dynamicDowncast<ErrorInstance>(JSValue::decode(value));
    return error && error->isParseError();
}

extern "C" bool Bun__DesktopRealm__describeError(JSGlobalObject* realm, EncodedJSValue value, BunString* text)
{
    auto* error = dynamicDowncast<ErrorInstance>(JSValue::decode(value));
    if (!error)
        return false;
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(realm->vm());
    String described = error->sanitizedToString(realm);
    if (scope.exception()) {
        scope.clearExceptionExceptTermination();
        return false;
    }
    *text = Bun::toStringRef(described).leak();
    return true;
}

static void trackRejection(JSGlobalObject* realm, JSPromise* promise, JSPromiseRejectionOperation operation)
{
    BUN_BEGIN_REMOVABLE_ENTRY_POINT(Desktop, Abort, void)
    if (!isRunning(realm))
        return;
    VM& vm = realm->vm();
    if (operation == JSPromiseRejectionOperation::Handle) {
        if (promise->getDirect(vm, outstandingName(vm)))
            Bun__DOM__rejectionWasHandled(realm, JSValue::encode(promise), JSValue::encode(promise->result()));
        return;
    }
    Bun__DOM__promiseWasRejected(realm, JSValue::encode(promise), JSValue::encode(promise->result()));
    BUN_END_REMOVABLE_ENTRY_POINT
}

static void reportRefusedEval(JSGlobalObject* realm, const String& source)
{
    if (!isRunning(realm))
        return;
    auto code = Bun::toString(source.isNull() ? emptyString() : source);
    Bun__WebRealm__allowsEval(stateOf(realm), &code);
}

static String codeOfTrustedScript(JSGlobalObject* realm, JSValue value)
{
    JSValue code = JSValue::decode(Bun__DOM__textOfTrustedScript(realm, JSValue::encode(value)));
    return code.isString() ? code.toWTFString(realm) : String();
}

static bool mayCompileString(JSGlobalObject* realm, CompilationType type, String code, const ArgList& arguments)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    bool result = Bun__DOM__mayCompile(realm, JSValue::encode(jsString(realm->vm(), code)), arguments.data(), arguments.size(), type == CompilationType::Function);
    RETURN_IF_EXCEPTION(scope, false);
    return result;
}

NEVER_INLINE JSObject* desktopRealmSerialize(JSGlobalObject* realm, JSObject* object, bool isForStorage)
{
    BUN_REMOVABLE_DEFINITION(Desktop, &desktopRealmSerialize);
    if (JSObject* target = IsolatedWorld::targetOf(object))
        object = target;
    return Bindgen::serializeInterface(realm, object, isForStorage);
}

extern "C" SYSV_ABI bool JSDOMFile__hasInstance(EncodedJSValue, JSGlobalObject*, EncodedJSValue);

void desktopRealmAdoptFile(JSGlobalObject* realm, JSValue blob)
{
    if (!isDesktopRealm(realm) || !blob || !blob.isObject() || !JSDOMFile__hasInstance(JSValue::encode(jsUndefined()), realm, JSValue::encode(blob)))
        return;
    VM& vm = realm->vm();
    JSObject* prototype = asObject(defaultGlobalObject(realm)->JSDOMFileConstructor()->getDirect(vm, vm.propertyNames->prototype));
    asObject(blob)->setStructure(vm, realm->structureCache().emptyStructureForPrototypeFromBaseStructure(realm, prototype, asObject(blob)->structure()));
}

static NEVER_INLINE JSValue deserializeInPage(JSGlobalObject* realm, JSObject* serialized)
{
    BUN_REMOVABLE_DEFINITION(Desktop, &deserializeInPage);
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    if (auto* page = IsolatedWorld::pageOf(realm)) {
        JSValue record = IsolatedWorld::toPage(realm, serialized);
        RETURN_IF_EXCEPTION(scope, {});
        JSValue made = desktopRealmDeserialize(page, asObject(record));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, IsolatedWorld::toWorld(realm, made));
    }
    JSValue native = Bindgen::deserializeInterface(realm, serialized);
    RETURN_IF_EXCEPTION(scope, {});
    return native ? native : jsNull();
}

JSValue desktopRealmDeserialize(JSGlobalObject* realm, JSObject* serialized)
{
    return isDesktopRealm(realm) && isRunning(realm) ? deserializeInPage(realm, serialized) : serialized;
}

extern "C" EncodedJSValue Bun__Modules__resolve(JSGlobalObject*, EncodedJSValue specifier, EncodedJSValue referrer, bool isForLoader);
extern "C" EncodedJSValue Bun__Modules__fetch(JSGlobalObject*, EncodedJSValue key, const BunString* type);
extern "C" EncodedJSValue Bun__Modules__urlOf(JSGlobalObject*, EncodedJSValue key);

static Identifier resolveModule(JSGlobalObject* realm, JSModuleLoader*, JSValue key, JSValue referrer, RefPtr<ScriptFetcher>, bool useImportMap)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    if (!useImportMap)
        RELEASE_AND_RETURN(scope, key.toPropertyKey(realm));
    JSValue resolved = JSValue::decode(Bun__Modules__resolve(realm, JSValue::encode(key), JSValue::encode(referrer), true));
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
    BunString borrowedType = Bun::toString(type);
    JSValue fetched = JSValue::decode(Bun__Modules__fetch(realm, JSValue::encode(key), &borrowedType));
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
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue url = JSValue::decode(Bun__Modules__urlOf(realm, JSValue::encode(key)));
    RETURN_IF_EXCEPTION(scope, nullptr);
    String referrer = key.toWTFString(realm);
    RETURN_IF_EXCEPTION(scope, nullptr);
    auto* resolve = JSNativeStdFunction::create(vm, realm, 1, "resolve"_s, [referrer](JSGlobalObject* realm, CallFrame* callFrame) -> EncodedJSValue {
        auto scope = DECLARE_THROW_SCOPE(realm->vm());
        JSString* specifier = callFrame->argument(0).toString(realm);
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, Bun__Modules__resolve(realm, JSValue::encode(specifier), JSValue::encode(jsString(realm->vm(), referrer)), false));
    });
    JSObject* meta = constructEmptyObject(vm, realm->nullPrototypeObjectStructure());
    meta->putDirect(vm, Identifier::fromString(vm, "url"_s), url);
    meta->putDirect(vm, vm.propertyNames->resolve, resolve);
    return meta;
}

#if ENABLE(WEBASSEMBLY)
extern "C" EncodedJSValue Bun__DOM__streamOfModule(JSGlobalObject*, EncodedJSValue response);

static JSValue nativeResponseFor(JSGlobalObject* realm, JSValue source)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSValue body = JSValue::decode(Bun__DOM__streamOfModule(realm, JSValue::encode(source)));
    RETURN_IF_EXCEPTION(scope, {});
    JSValue constructor = uncheckedDowncast<Zig::GlobalObject>(realm)->natives()->get(realm, Identifier::fromString(vm, "Response"_s));
    RETURN_IF_EXCEPTION(scope, {});
    auto* headers = constructEmptyObject(vm, realm->nullPrototypeObjectStructure());
    headers->putDirect(vm, Identifier::fromString(vm, "content-type"_s), jsNontrivialString(vm, "application/wasm"_s));
    auto* init = constructEmptyObject(vm, realm->nullPrototypeObjectStructure());
    init->putDirect(vm, Identifier::fromString(vm, "headers"_s), headers);
    MarkedArgumentBuffer arguments;
    arguments.append(body);
    arguments.append(init);
    RELEASE_AND_RETURN(scope, construct(realm, constructor, arguments, ""_s));
}

// Empty if the promise has been rejected.
static JSValue nativeResponseFor(JSGlobalObject* realm, JSPromise* promise, JSValue source)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* page = IsolatedWorld::pageOf(realm);
    JSValue response = page ? IsolatedWorld::inPage(realm, source, nativeResponseFor) : nativeResponseFor(realm, source);
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

template<bool isCrossOriginIsolated>
static RuntimeFlags runtimeFlagsOfWebRealm(const JSGlobalObject*)
{
    RuntimeFlags flags { RuntimeFlags::ShadowRealmHidden, RuntimeFlags::CallerOfOtherRealmHidden };
    flags.setSharedArrayBufferHidden(!isCrossOriginIsolated);
    return flags;
}

// With a module host, the realm gets an instance of the compiled program.
template<bool runsCompiledProgram, bool isCrossOriginIsolated>
static const GlobalObjectMethodTable& desktopRealmMethodTable()
{
    static const GlobalObjectMethodTable table = [] {
        GlobalObjectMethodTable table = Zig::GlobalObject::globalObjectMethodTable();
        table.javaScriptRuntimeFlags = &runtimeFlagsOfWebRealm<isCrossOriginIsolated>;
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
#if ENABLE(AOT)
        if (runsCompiledProgram)
            table.moduleHost = &WebGlobalObject::moduleHost();
#endif
        return table;
    }();
    return table;
}

static WebGlobalObject* createRealm(JSGlobalObject* globalObject, WebGlobalObject::Kind kind, bool isIsolated, JSGlobalProxy* proxy)
{
    VM& vm = globalObject->vm();
    bool runsCompiledProgram = vm.hasCompiledCode() && compiledProgramRunsInSeveralRealmsAtOnce();
    DeferGC deferGC(vm);
    auto& methodTable = runsCompiledProgram
        ? (isIsolated ? desktopRealmMethodTable<true, true>() : desktopRealmMethodTable<true, false>())
        : (isIsolated ? desktopRealmMethodTable<false, true>() : desktopRealmMethodTable<false, false>());
    auto* realm = WebGlobalObject::create(vm, kind, &methodTable);
    if (proxy) {
        proxy->setTarget(vm, realm);
        proxy->setPrototypeDirect(vm, realm->getPrototypeDirect());
        realm->addressOfGlobalThis()->set(vm, realm, proxy);
    }
#if ENABLE(AOT)
    if (runsCompiledProgram) {
        AOT::acceptForeignBinaryData(globalObject);
        AOT::acceptForeignBinaryData(realm);
    }
#endif
    defaultGlobalObject(vm)->addDerivedRealm(realm);
    return realm;
}

static void setUpMembers(WebGlobalObject* realm)
{
    VM& vm = realm->vm();
    realm->setMembers(vm, constructEmptyObject(vm, realm->nullPrototypeObjectStructure()));
}

extern "C" EncodedJSValue Bun__DOM__createPage(JSGlobalObject*, EncodedJSValue host, EncodedJSValue global, EncodedJSValue baseURL, EncodedJSValue agent);

extern "C" void Bun__WebRealm__adoptClient(void*, uint32_t client);

// `page` is for an isolated world, `window` the handle of the object to take over. Null if it throws.
extern "C" JSGlobalObject* Bun__DesktopRealm__createWindow(JSGlobalObject* globalObject, uint32_t client, bool isSecure, bool isIsolated, WebGlobalObject::NodeGlobals nodeGlobals, EncodedJSValue window, JSGlobalObject* page)
{
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    // What sets it up is not to stop halfway.
    if (!vm.ensureJSStackCapacityFor(static_cast<Register*>(currentStackPointer()) - 256 * KB / sizeof(Register))) [[unlikely]] {
        throwStackOverflowError(globalObject, scope);
        return nullptr;
    }
    auto* realm = createRealm(globalObject, { WebGlobalObject::Scope::Window, isSecure, isIsolated, nodeGlobals, !!page }, isIsolated, dynamicDowncast<JSGlobalProxy>(RealmBridge::peek(JSValue::decode(window))));
    Bun__WebRealm__adoptClient(realm->realm(), client);
    if (page) {
        IsolatedWorld::enter(realm, page);
        RETURN_IF_EXCEPTION(scope, nullptr);
        realm->setRunning(true);
    }
    return realm;
}

extern "C" EncodedJSValue Bun__DesktopRealm__setUpPage(JSGlobalObject* globalObject, WebGlobalObject* realm, EncodedJSValue host, EncodedJSValue baseURL, EncodedJSValue agent)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    JSValue ownHost = RealmBridge::cross(realm, JSValue::decode(host));
    RETURN_IF_EXCEPTION(scope, {});
    setUpMembers(realm);
    JSValue page = JSValue::decode(Bun__DOM__createPage(realm, JSValue::encode(ownHost), JSValue::encode(realm->globalThis()), baseURL, JSValue::encode(RealmBridge::peek(JSValue::decode(agent)))));
    RETURN_IF_EXCEPTION(scope, {});
    realm->setRunning(true);
    RELEASE_AND_RETURN(scope, JSValue::encode(RealmBridge::cross(globalObject, page)));
}

// What a preload script finds on the global object comes from there.
extern "C" EncodedJSValue Bun__DesktopRealm__members(WebGlobalObject* realm)
{
    return JSValue::encode(realm->members());
}

extern "C" JSGlobalObject* Bun__DesktopRealm__createForWorker(JSGlobalObject* globalObject, WebGlobalObject::Scope scope, bool isSecureContext, bool isIsolated)
{
    return createRealm(globalObject, { scope, isSecureContext, isIsolated, {}, false }, isIsolated, nullptr);
}

extern "C" void Bun__DesktopRealm__setUpWorker(WebGlobalObject* realm)
{
    setUpMembers(realm);
    realm->setRunning(true);
}

extern "C" void Bun__DesktopWorker__failed(uint32_t, const BunString* message);
extern "C" void Bun__DesktopWorker__ended(uint32_t);

class WorkerWatcher final : public WebCore::EventListener {
public:
    explicit WorkerWatcher(uint32_t id)
        : EventListener(NativeEventListenerType)
        , m_id(id)
    {
    }

private:
    bool operator==(const EventListener& other) const final { return this == &other; }
    void handleEvent(WebCore::ScriptExecutionContext&, WebCore::Event& event) final
    {
        if (event.type() == WebCore::eventNames().closeEvent)
            return Bun__DesktopWorker__ended(m_id);
        auto message = Bun::toString(static_cast<WebCore::ErrorEvent&>(event).message());
        Bun__DesktopWorker__failed(m_id, &message);
    }

    uint32_t m_id;
};

extern "C" WebCore::Worker* Bun__DesktopWorker__start(Zig::GlobalObject* globalObject, const BunString* name, uint32_t id, void (*entry)(JSGlobalObject*, uint32_t id))
{
    WebCore::WorkerOptions options;
    options.name = name->toWTFString().isolatedCopy();
    options.mini = true;
    options.unref = true;
    options.env.emplace();
    options.nativeEntry = entry;
    options.argumentOfNativeEntry = id;
    auto worker = WebCore::Worker::create(*globalObject->scriptExecutionContext(), emptyString(), WTF::move(options));
    if (worker.hasException())
        return nullptr;
    Ref watcher = adoptRef(*new WorkerWatcher(id));
    worker.returnValue()->addEventListener(WebCore::eventNames().errorEvent, watcher.copyRef(), {});
    worker.returnValue()->addEventListener(WebCore::eventNames().closeEvent, WTF::move(watcher), {});
    return &worker.releaseReturnValue().leakRef();
}

extern "C" void Bun__DesktopWorker__terminate(WebCore::Worker* worker)
{
    adoptRef(*worker)->terminate();
}

extern "C" EncodedJSValue Bun__Desktop__createPage(Zig::GlobalObject* realm, EncodedJSValue host, bool mayHaveGlobalObject)
{
    auto* window = mayHaveGlobalObject ? dynamicDowncast<WebGlobalObject>(realm) : nullptr;
    if (window)
        setUpMembers(window);
    return Bun__DOM__createPage(realm, host, JSValue::encode(window ? window->globalThis() : jsUndefined()), encodedJSUndefined(), encodedJSUndefined());
}

extern "C" void Bun__DesktopRealm__documentChanged(WebGlobalObject* realm)
{
    realm->forgetSameObjects(realm->vm());
}

extern "C" void Bun__WebRealm__stop(void*);

// `isReachable`: the scripts of other documents may have its promises.
extern "C" void Bun__DesktopRealm__dispose(WebGlobalObject* realm, bool isReachable)
{
    realm->setRunning(false);
    Bun__WebRealm__stop(realm->realm());
    realm->scriptExecutionContext()->prepareForDestruction();
    realm->setMicrotaskRunnability(isReachable ? QueuedTaskResult::Executed : QueuedTaskResult::Discard);
}

static void setEvalEnabled(JSGlobalObject* realm, bool isEnabled)
{
    realm->setEvalEnabled(isEnabled && codeGenerationFromStrings() == CodeGenerationFromStrings::Allowed, "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the Content Security Policy"_s);
}

// For the document that takes over the window of an initial empty one.
extern "C" void Bun__DesktopRealm__liftRestrictions(JSGlobalObject* realm)
{
    setEvalEnabled(realm, true);
    realm->setWebAssemblyEnabled(true);
    realm->setTrustedTypesEnforcement(TrustedTypesEnforcement::None);
}

// It never lifts a restriction.
extern "C" void Bun__DesktopRealm__restrictCode(JSGlobalObject* realm, bool allowsEval, bool allowsWebAssembly, bool watchesEval)
{
    if (!allowsEval)
        setEvalEnabled(realm, false);
    if (!allowsWebAssembly)
        realm->setWebAssemblyEnabled(false, "Refused to compile WebAssembly because 'wasm-unsafe-eval' is not an allowed source of script in the Content Security Policy"_s);
    if (watchesEval)
        realm->setTrustedTypesEnforcement(TrustedTypesEnforcement::Enforced);
}

struct EvalPolicy {
    bool allows;
    bool watches;
};

// Whatever the Content Security Policy says about strings that become code, until restrictCode gets the result.
extern "C" EvalPolicy Bun__DesktopRealm__allowEval(JSGlobalObject* realm)
{
    EvalPolicy before { realm->evalEnabled(), realm->trustedTypesEnforcement() != TrustedTypesEnforcement::None };
    setEvalEnabled(realm, true);
    realm->setTrustedTypesEnforcement(TrustedTypesEnforcement::None);
    return before;
}

static SourceCode sourceCodeFrom(const String& source, String&& url, const String& base, int line, int column, SourceProviderSourceType type)
{
    TextPosition start { OrdinalNumber::fromZeroBasedInt(line), OrdinalNumber::fromZeroBasedInt(column) };
    return SourceCode(StringSourceProvider::create(source, SourceOrigin { URL({}, base) }, WTF::move(url), SourceTaintedOrigin::Untainted, start, type));
}

static EncodedJSValue run(JSGlobalObject* realm, const SourceCode& source)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    NakedPtr<JSC::Exception> exception;
    JSValue result = evaluate(realm, source, realm->globalThis(), exception);
    if (exception) {
        // Leaving the VM has withdrawn it.
        if (vm.isTerminationException(exception.get()) && !vm.hasTerminationRequest())
            vm.setHasTerminationRequest();
        scope.throwException(realm, exception.get());
        return {};
    }
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

// `base` is what `import()` resolves against.
extern "C" EncodedJSValue Bun__WebRealm__evaluate(JSGlobalObject* realm, StringImpl* source, const BunString* url, const BunString* base, uint32_t line, uint32_t column)
{
    return run(realm, sourceCodeFrom(source, url->toWTFString(), base->toWTFString(), line, column, SourceProviderSourceType::Program));
}

extern "C" EncodedJSValue Bun__DesktopRealm__evaluate(JSGlobalObject* realm, EncodedJSValue source, const BunString* url, const BunString* base)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    String text = JSValue::decode(source).toWTFString(realm);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, run(realm, makeSource(text, SourceOrigin { URL({}, base->toWTFString()) }, SourceTaintedOrigin::Untainted, url->toWTFString())));
}

// (source, window, awaits)
JSC_DEFINE_HOST_FUNCTION(inject, (JSGlobalObject * realm, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    String source = callFrame->uncheckedArgument(0).toWTFString(realm);
    RETURN_IF_EXCEPTION(scope, {});
    bool isBorrowed = callFrame->uncheckedArgument(1).isObject();
    JSValue result = JSValue::decode(run(realm, makeSource(isBorrowed ? "(function(){with(this)return eval(arguments[0])})"_s : source, SourceOrigin {}, SourceTaintedOrigin::Untainted)));
    RETURN_IF_EXCEPTION(scope, {});
    if (isBorrowed) {
        auto before = Bun__DesktopRealm__allowEval(realm);
        result = call(realm, result, getCallData(result), callFrame->uncheckedArgument(1), ArgList { std::bit_cast<EncodedJSValue*>(callFrame->addressOfArgumentsStart()), 1 });
        Bun__DesktopRealm__restrictCode(realm, before.allows, true, before.watches);
        RETURN_IF_EXCEPTION(scope, {});
    }
    RELEASE_AND_RETURN(scope, JSValue::encode(callFrame->uncheckedArgument(2).isTrue() ? JSPromise::resolvedPromise(realm, result) : result));
}

// What the app runs in a page. `window` is one without a realm of its own: names are looked up in it first.
extern "C" EncodedJSValue Bun__DesktopRealm__inject(JSGlobalObject* realm, EncodedJSValue source, EncodedJSValue window, bool awaits)
{
    auto scope = DECLARE_THROW_SCOPE(realm->vm());
    // It is public, so that `Function.prototype.caller` does not look past it.
    auto* barrier = JSFunction::create(realm->vm(), realm, 0, emptyString(), inject, ImplementationVisibility::Public);
    EncodedJSValue arguments[] = { source, window, JSValue::encode(jsBoolean(awaits)) };
    JSValue result = call(realm, barrier, getCallData(barrier), jsUndefined(), ArgList { arguments, 3 });
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result);
}

extern "C" EncodedJSValue Bun__DesktopRealm__compileHandler(JSGlobalObject* realm, const EncodedJSValue* strings, const EncodedJSValue* scopes)
{
    VM& vm = realm->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (!isDesktopRealm(realm) && !realm->evalEnabled()) {
        throwException(realm, scope, createEvalError(realm, realm->evalDisabledErrorMessage()));
        return {};
    }
    std::array<String, 5> texts;
    for (size_t i = 0; i < texts.size(); i++) {
        texts[i] = JSValue::decode(strings[i]).toWTFString(realm);
        RETURN_IF_EXCEPTION(scope, {});
    }
    auto& [name, parameters, body, url, base] = texts;
    String program = tryMakeString("function "_s, name, '(', parameters, ") {\n"_s, body, "\n}"_s);
    if (!program) {
        throwOutOfMemoryError(realm, scope);
        return {};
    }
    JSObject* function = constructFunctionSkippingEvalEnabledCheck(realm, WTF::move(program), TaintedByWithScopeLexicallyScopedFeature, Identifier::fromString(vm, name), SourceOrigin { URL({}, base) }, url, SourceTaintedOrigin::Untainted, TextPosition());
    RETURN_IF_EXCEPTION(scope, {});
    auto* handler = uncheckedDowncast<JSFunction>(function);
    for (EncodedJSValue it : std::span { scopes, 3 }) {
        if (JSObject* object = JSValue::decode(it).getObject())
            handler->setScope(vm, JSWithScope::create(vm, realm, handler->scope(), object));
    }
    return JSValue::encode(handler);
}

// (url)
extern "C" EncodedJSValue Bun__DesktopRealm__import(JSGlobalObject* realm, const BunString* url)
{
    return JSValue::encode(importModuleFrom(realm, realm->moduleLoader(), jsString(realm->vm(), url->toWTFString()), nullptr, SourceOrigin(), false));
}

// Fetches it and what it imports.
extern "C" EncodedJSValue Bun__WebRealm__loadModule(JSGlobalObject* realm, const BunString* key)
{
    return JSValue::encode(loadModule(realm, Identifier::fromString(realm->vm(), key->toWTFString()), RefPtr<ScriptFetchParameters>(), nullptr));
}

// One that was loaded.
extern "C" EncodedJSValue Bun__WebRealm__evaluateModule(JSGlobalObject* realm, const BunString* key)
{
    return JSValue::encode(linkAndEvaluateModule(realm, Identifier::fromString(realm->vm(), key->toWTFString()), nullptr));
}

// What the promise of `Bun__Modules__fetch` is fulfilled with.
extern "C" EncodedJSValue Bun__WebRealm__moduleSource(JSGlobalObject* realm, StringImpl* source, const BunString* url, const BunString* base, bool isJSON, uint32_t line, uint32_t column)
{
    auto type = isJSON ? SourceProviderSourceType::JSON : SourceProviderSourceType::Module;
    return JSValue::encode(JSSourceCode::create(realm->vm(), sourceCodeFrom(source, url->toWTFString(), base->toWTFString(), line, column, type)));
}

// Its microtasks wait.
extern "C" void Bun__WebGlobalObject__setPaused(JSGlobalObject* realm, bool isPaused)
{
    realm->setMicrotaskRunnability(isPaused ? QueuedTaskResult::Suspended : QueuedTaskResult::Executed);
}

extern "C" bool Bun__hasLocalMessages()
{
    return WebCore::MessagePortPipe::hasLocalDrain();
}

extern "C" EncodedJSValue Bun__exchangeAsyncContext(JSGlobalObject* globalObject, EncodedJSValue context)
{
    auto* data = globalObject->m_asyncContextData.get();
    JSValue before = data->getInternalField(0);
    data->putInternalField(globalObject->vm(), 0, JSValue::decode(context));
    return JSValue::encode(before);
}

static EncodedJSValue runCompiled(JSGlobalObject* globalObject, const String& path, bool isSynchronous)
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    auto* realm = uncheckedDowncast<Zig::GlobalObject>(globalObject);
    JSValue result = isSynchronous ? loadCompiledModuleNamespace(realm, path) : JSValue(importCompiledModule(realm, path, nullptr, -1));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(result ? result : jsUndefined());
}

extern "C" EncodedJSValue Bun__WebRealm__runCompiled(JSGlobalObject* realm, const BunString* path, bool isSynchronous)
{
    return runCompiled(realm, path->toWTFString(), isSynchronous);
}

} // namespace Bun
