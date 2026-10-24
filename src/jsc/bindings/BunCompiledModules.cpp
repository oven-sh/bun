#include "root.h"

#include "BunCompiledModules.h"

#include "BunAOTCompile.h"
#include "BunClientData.h"
#include "CodeGenerationFromStrings.h"
#include "ErrorCode.h"
#include "ImportMetaObject.h"
#include "JSCommonJSExtensions.h"
#include "JSCommonJSModule.h"
#include "ModuleLoader.h"
#include "WebCoreJSBuiltins.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/AOTSchemaEnums.h>
#include <JavaScriptCore/AbstractModuleRecord.h>
#include <JavaScriptCore/CallData.h>
#include <JavaScriptCore/CustomGetterSetter.h>
#include <JavaScriptCore/JSBoundFunction.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/RegExp.h>
#include <wtf/SetForScope.h>

#if ENABLE(AOT)

extern "C" BunLoaderType Bun__getDefaultLoader(JSC::JSGlobalObject*, const BunString* specifier);
extern "C" JSC::EncodedJSValue Blob__createEmptyJSONBodyError(JSC::JSGlobalObject*);
extern "C" bool Bun__compiledProgramRunsInPlace();

namespace Bun {
using namespace JSC;

#if OS(WINDOWS)
static constexpr bool hostHasTwoSeparators = true;
#else
static constexpr bool hostHasTwoSeparators = false;
#endif

std::optional<AOT::ModuleID> compiledModuleForPath(const String& path)
{
    if (!hasCompiledModules())
        return std::nullopt;
    std::optional<AOT::ModuleID> found = AOT::findModule(path);
    if (found || !hostHasTwoSeparators)
        return found;
    // A file of an executable is `B:/~BUN/root/a.ts`, one that runs in place `C:\\a.ts`, and a program spells either with the other separator.
    if (path.contains('\\'))
        found = AOT::findModule(makeStringByReplacingAll(path, '\\', '/'));
    if (!found && path.contains('/'))
        found = AOT::findModule(makeStringByReplacingAll(path, '/', '\\'));
    return found;
}

static std::optional<AOT::ModuleID> compiledModuleForRequest(const String& path, bool hasImportAttributes)
{
    if (hasImportAttributes)
        return std::nullopt;
    return compiledModuleForPath(path);
}

JSPromise* compiledModuleSource(Zig::GlobalObject* globalObject, const String& key, bool hasImportAttributes)
{
    auto module = compiledModuleForRequest(key, hasImportAttributes);
    if (!module)
        return nullptr;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    AbstractModuleRecord* record = AOT::moduleRecord(globalObject, *module);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSPromise* source = JSPromise::create(vm, globalObject->promiseStructure());
    source->fulfill(vm, record);
    return source;
}

JSPromise* importCompiledModule(Zig::GlobalObject* globalObject, const String& key, bool hasImportAttributes, int64_t referrerAsyncOrder)
{
    auto module = compiledModuleForRequest(key, hasImportAttributes);
    if (!module)
        return nullptr;
    return AOT::importModule(globalObject, *module, referrerAsyncOrder < 0 ? std::nullopt : std::optional(referrerAsyncOrder));
}

static std::optional<AOT::ModuleID> compiledModuleOf(JSCommonJSModule* module)
{
    if (module->compiledModule == JSCommonJSModule::noCompiledModule)
        return std::nullopt;
    return AOT::ModuleID(module->compiledModule);
}

static void requireInto(Zig::GlobalObject* globalObject, JSCommonJSModule* target, AOT::ModuleID module)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSValue exports = AOT::requireModule(globalObject, module);
    RETURN_IF_EXCEPTION(scope, void());
    target->setExportsObject(exports);
}

bool requireCompiledModule(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path, bool hasImportAttributes)
{
    auto module = compiledModuleForRequest(path, hasImportAttributes);
    if (!module)
        return false;
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSCommonJSModule* requirer = target->m_parent.get();
    // `target` is the object that require() under a computed name has made to load the file into.
    auto referrer = requirer ? compiledModuleOf(requirer) : std::nullopt;
    if (referrer && AOT::recordRequire(globalObject, *module, *referrer))
        target->compiledModule = module->index();
    requireInto(globalObject, target, *module);
    RETURN_IF_EXCEPTION(scope, false);
    if (referrer)
        AOT::recordRequire(globalObject, *module, *referrer);
    // A module of the executable is in no cache. The next require() of the name asks the engine again, which answers what the module exports then.
    globalObject->requireMap()->remove(globalObject, jsString(vm, path));
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

JSValue loadCompiledModuleNamespace(Zig::GlobalObject* globalObject, const String& path)
{
    auto module = compiledModuleForPath(path);
    if (!module)
        return {};
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    AOT::evaluateModuleSynchronously(globalObject, *module);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, AOT::moduleNamespace(globalObject, *module));
}

bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject* globalObject, JSCommonJSModule* target, const String& path, bool isTypeScriptLoader)
{
    if (!hasCompiledModules() || target->moduleGraph() || target->m_overriddenCompile) [[likely]]
        return false;
    auto module = compiledModuleForPath(path);
    if (!module)
        return false;
    BunString pathString = Bun::toString(path);
    auto loader = Bun__getDefaultLoader(globalObject, &pathString);
    bool isTypeScriptFile = loader == BunLoaderTypeTS || loader == BunLoaderTypeTSX;
    if (isTypeScriptFile != isTypeScriptLoader)
        return false;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    requireInto(globalObject, target, *module);
    RETURN_IF_EXCEPTION(scope, false);
    target->hasEvaluated = true;
    return true;
}

void willSetRequireCacheEntry(Zig::GlobalObject* globalObject, const String& key, JSValue entry)
{
    if (auto module = compiledModuleForPath(key))
        AOT::willSetRequireCacheEntry(globalObject, *module, entry);
}

static JSCommonJSModule* boundModuleOf(JSValue require)
{
    auto* bound = dynamicDowncast<JSBoundFunction>(require);
    return bound ? dynamicDowncast<JSCommonJSModule>(bound->boundThis()) : nullptr;
}

static bool isRequireFunctionOf(Zig::GlobalObject* globalObject, JSCommonJSModule* module, JSValue function)
{
    return boundModuleOf(function) == module && uncheckedDowncast<JSBoundFunction>(function)->targetFunction() == globalObject->requireFunctionUnbound();
}

// As without compiled modules, evaluating a module replaces whatever the program stored in `module.require`.
static JSObject* attachRequireFunction(VM& vm, Zig::GlobalObject* globalObject, JSCommonJSModule* module, JSString* path)
{
    const Identifier& requireName = WebCore::clientData(vm)->builtinNames().requirePublicName();
    JSValue ownRequire = module->getDirect(vm, requireName);
    if (ownRequire && isRequireFunctionOf(globalObject, module, ownRequire))
        return asObject(ownRequire);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String pathText = path->value(globalObject);
    RETURN_IF_EXCEPTION(scope, nullptr);
    JSObject* require = JSCommonJSModule::createBoundRequireFunction(vm, globalObject, pathText, nullptr, module);
    RETURN_IF_EXCEPTION(scope, nullptr);
    module->putDirect(vm, requireName, require, 0);
    return require;
}

// `module.exports` of a file of the executable is a variable of the program, which its code reads and stores without the module object.
JSC_DEFINE_CUSTOM_GETTER(getterExportsOfCompiledModule, (JSGlobalObject*, EncodedJSValue thisValue, PropertyName))
{
    auto* module = dynamicDowncast<JSCommonJSModule>(JSValue::decode(thisValue));
    auto compiled = module ? compiledModuleOf(module) : std::nullopt;
    if (!compiled) [[unlikely]]
        return JSValue::encode(jsUndefined());
    return JSValue::encode(AOT::moduleExports(module->globalObject(), *compiled));
}

JSC_DEFINE_CUSTOM_SETTER(setterExportsOfCompiledModule, (JSGlobalObject*, EncodedJSValue thisValue, EncodedJSValue value, PropertyName))
{
    auto* module = dynamicDowncast<JSCommonJSModule>(JSValue::decode(thisValue));
    auto compiled = module ? compiledModuleOf(module) : std::nullopt;
    if (!compiled) [[unlikely]]
        return false;
    AOT::setModuleExports(module->globalObject(), *compiled, JSValue::decode(value));
    return true;
}

static void createModuleObject(JSGlobalObject* realm, JSString* path, AOT::ModuleID compiled, OptionSet<AOT::ModuleObjectTrait> traits, AOT::ModuleObjects& out)
{
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    // putDirectCustomAccessor() is for a name that the object does not have yet.
    JSValue exportsAsData = traits.contains(AOT::ModuleObjectTrait::HasExportsVariable) ? JSValue() : jsUndefined();
    JSCommonJSModule* module = JSCommonJSModule::create(globalObject, path, exportsAsData, true, JSValue());
    RETURN_IF_EXCEPTION(scope, void());
    module->compiledModule = compiled.index();
    if (traits.contains(AOT::ModuleObjectTrait::IsMain))
        module->m_id.set(vm, module, jsString(vm, String("."_s)));
    if (traits.contains(AOT::ModuleObjectTrait::HasExportsVariable)) {
        auto* accessors = CustomGetterSetter::create(vm, getterExportsOfCompiledModule, setterExportsOfCompiledModule);
        module->putDirectCustomAccessor(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), accessors, PropertyAttribute::CustomValue | 0);
    }
    out.module = module;
    scope.release();
    out.require = attachRequireFunction(vm, globalObject, module, path);
}

static void createRequirer(JSGlobalObject* realm, JSObject* importMeta, AOT::ModuleObjects& out)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* meta = uncheckedDowncast<Zig::ImportMetaObject>(importMeta);
    out.require = meta->requireProperty.getInitializedOnMainThread(meta);
    RETURN_IF_EXCEPTION(scope, void());
    out.module = boundModuleOf(out.require);
    if (out.module) [[likely]]
        return;

    // The program replaced import.meta.require with a value that is not bound to a module object.
    String path = meta->pathProperty.getInitializedOnMainThread(meta)->value(realm);
    RETURN_IF_EXCEPTION(scope, void());
    JSObject* ownRequire = JSCommonJSModule::createBoundRequireFunction(vm, realm, path, meta->moduleGraph());
    RETURN_IF_EXCEPTION(scope, void());
    out.module = boundModuleOf(ownRequire);
}

static void pushObservableChild(JSGlobalObject* realm, JSObject* parent, JSObject* child)
{
    auto& vm = getVM(realm);
    JSFunction* function = JSFunction::create(vm, realm, WebCore::commonJSPushObservableChildCodeGenerator(vm), realm);
    MarkedArgumentBuffer arguments;
    arguments.append(uncheckedDowncast<JSCommonJSModule>(parent)->m_childrenValue.get());
    arguments.append(child);
    call(realm, function, getCallData(function), jsUndefined(), arguments);
}

bool appendNewChildrenOfCompiledModule(JSGlobalObject* realm, JSCommonJSModule* parent)
{
    auto compiled = compiledModuleOf(parent);
    if (!compiled)
        return true;
    auto& vm = getVM(realm);
    return AOT::forEachNewChild(parent->globalObject(), *compiled, [&](JSObject* child) {
        if (parent->m_childrenValue) {
            pushObservableChild(realm, parent, child);
            return;
        }
        WTF::Locker locker { parent->cellLock() };
        parent->m_children.append(WriteBarrier<Unknown>());
        parent->m_children.last().set(vm, parent, child);
    });
}

JSCommonJSModule* parentOfCompiledModule(JSCommonJSModule* module)
{
    auto compiled = compiledModuleOf(module);
    JSObject* parent = compiled ? AOT::parentModuleObject(module->globalObject(), *compiled) : nullptr;
    return parent ? dynamicDowncast<JSCommonJSModule>(parent) : nullptr;
}

JSValue mainModuleOfExecutable(Zig::GlobalObject* globalObject)
{
    JSObject* main = AOT::mainModuleObject(globalObject);
    return main ? JSValue(main) : jsUndefined();
}

static JSValue requireSpecifier(JSGlobalObject* realm, JSObject* requirer, JSValue specifier)
{
    auto& vm = getVM(realm);
    JSValue function = realm->getDirect(vm, WebCore::builtinNames(vm).overridableRequirePrivateName());
    MarkedArgumentBuffer arguments;
    arguments.append(specifier);
    return call(realm, function, requirer, arguments, "Module.prototype.require is not a function"_s);
}

static JSValue resolveSpecifier(JSGlobalObject* realm, JSObject* holder, JSValue specifier, AOT::ResolvedSpecifierForm form)
{
    JSObject* function = nullptr;
    switch (form) {
    case AOT::ResolvedSpecifierForm::PathForRequire: {
        auto& vm = getVM(realm);
        auto scope = DECLARE_THROW_SCOPE(vm);
        JSValue from = holder->get(realm, WebCore::builtinNames(vm).filenamePublicName());
        RETURN_IF_EXCEPTION(scope, {});
        JSValue resolved = JSValue::decode(Bun__resolveSync(realm, JSValue::encode(specifier), JSValue::encode(from), false, false));
        RETURN_IF_EXCEPTION(scope, {});
        if (!resolved.isString()) {
            throwException(realm, scope, resolved);
            return {};
        }
        return resolved;
    }
    case AOT::ResolvedSpecifierForm::Path:
        function = uncheckedDowncast<Zig::GlobalObject>(realm)->requireResolveFunctionUnbound();
        break;
    case AOT::ResolvedSpecifierForm::URL:
        function = JSFunction::create(getVM(realm), realm, 1, "resolve"_s, Zig::functionImportMeta__resolve, ImplementationVisibility::Public);
        break;
    }
    MarkedArgumentBuffer arguments;
    arguments.append(specifier);
    return call(realm, function, getCallData(function), holder, arguments);
}

static JSObject* captureRuntimeModuleExports(JSGlobalObject* globalObject, JSValue value, Vector<Identifier, 4>& names, MarkedArgumentBuffer& values)
{
    if (JSObject* object = value.getObject())
        return appendInternalModuleExports(uncheckedDowncast<Zig::GlobalObject>(globalObject), object, names, values);
    names.append(getVM(globalObject).propertyNames->defaultKeyword);
    values.append(value);
    return nullptr;
}

static JSObject* captureSyntheticExports(JSGlobalObject* globalObject, AOT::SyntheticExportRule rule, JSValue value, Vector<Identifier, 4>& names, MarkedArgumentBuffer& values)
{
    switch (rule) {
    case AOT::SyntheticExportRule::CommonJs:
    case AOT::SyntheticExportRule::CommonJsIgnoringAnnotation:
        populateESMExports(globalObject, value, names, values, rule == AOT::SyntheticExportRule::CommonJsIgnoringAnnotation);
        return nullptr;
    case AOT::SyntheticExportRule::RuntimeModule:
        return captureRuntimeModuleExports(globalObject, value, names, values);
    case AOT::SyntheticExportRule::None:
        break;
    }
    RELEASE_ASSERT_NOT_REACHED();
}

static JSValue requireNativeModule(JSGlobalObject* realm, JSString* specifier)
{
    auto& vm = getVM(realm);
    auto scope = DECLARE_THROW_SCOPE(vm);
    String text = specifier->value(realm);
    RETURN_IF_EXCEPTION(scope, {});
    BunString name = Bun::toString(text);
    JSValue exports = resolveAndFetchBuiltinModule(uncheckedDowncast<Zig::GlobalObject>(realm), &name);
    RETURN_IF_EXCEPTION(scope, {});
    if (exports)
        return exports;

    // The name of a built-in module resolves to itself from every file.
    JSObject* require = JSCommonJSModule::createBoundRequireFunction(vm, realm, text, nullptr);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, requireSpecifier(realm, boundModuleOf(require), specifier));
}

static JSObject* captureNativeModuleExports(JSGlobalObject* realm, uint32_t registryID, Vector<Identifier, 4>& names, MarkedArgumentBuffer& values)
{
    return appendNativeModuleExports(uncheckedDowncast<Zig::GlobalObject>(realm), registryID, names, values);
}

static JSObject* requireCache(JSGlobalObject* realm)
{
    return uncheckedDowncast<Zig::GlobalObject>(realm)->lazyRequireCacheObject();
}

static JSObject* requireExtensions(JSGlobalObject* realm)
{
    return uncheckedDowncast<Zig::GlobalObject>(realm)->lazyRequireExtensionsObject();
}

static JSObject* createEmptyJSONBodyError(JSGlobalObject* realm)
{
    return asObject(JSValue::decode(Blob__createEmptyJSONBodyError(realm)));
}

static thread_local bool isAskingWhyFileFailsToLoad = false;

// The file is read and parsed as `require` reads it, and nothing of it runs.
static JSValue createLoadError(JSGlobalObject* realm, const String& path)
{
    if (!Bun__compiledProgramRunsInPlace())
        return {};
    auto* globalObject = uncheckedDowncast<Zig::GlobalObject>(realm);
    BunString specifier = Bun::toString(path);
    ErrorableResolvedSource source;
    SetForScope isAsking(isAskingWhyFileFailsToLoad, true);
    Bun__transpileFile(globalObject->bunVM(), globalObject, &specifier, &specifier, nullptr, &source, false, true, BunLoaderTypeNone);
    return source.success ? JSValue() : JSValue::decode(source.result.err);
}

const AOT::ModuleHost compiledModuleHost = {
    &createModuleObject,
    &createRequirer,
    &requireSpecifier,
    &resolveSpecifier,
    &captureSyntheticExports,
    &requireNativeModule,
    &captureNativeModuleExports,
    &requireCache,
    &requireExtensions,
    &createAsyncModuleRequiredError,
    &createEmptyJSONBodyError,
    &createLoadError,
};

JSValue createNotInExecutableError(JSGlobalObject* globalObject, ErrorCode code, const String& path, NotInExecutable what)
{
    // --disallow-code-generation-from-strings=strict refuses code from the disk in an executable built without --aot too. Whoever set the flag expects its error.
    if (what == NotInExecutable::Code && isCodeGenerationFromStringsStrictByFlags())
        return createCodeGenerationFromStringsError(globalObject);
    return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable, which only runs code that was compiled into it. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk."_s));
}

JSValue errorIfCodeOutsideImageIsRefused(JSGlobalObject* globalObject, ErrorCode code, const String& path)
{
    if (!hasCompiledModules() || isAskingWhyFileFailsToLoad)
        return {};
    bool refusesCode = AOT::refusesCodeOutsideImage(globalObject);
    // An executable does not hold the text of a compiled module.
    if (isCompiledModule(path) && (refusesCode || !compiledModulesRunInPlaceOfFiles()))
        return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it's compiled into this executable, and a compiled module can't be loaded a second time (for example into a Bun.ModuleGraph)."_s));
    if (!refusesCode)
        return {};
    return createNotInExecutableError(globalObject, code, path);
}

JSValue errorIfHostObjectOutsideImageIsRefused(JSGlobalObject* globalObject, ErrorCode code, const String& path)
{
    if (!hasCompiledModules() || !AOT::refusesHostObjectsOutsideImage(globalObject))
        return {};
    return createNotInExecutableError(globalObject, code, path, NotInExecutable::HostObject);
}

JSValue parentSeenBy(Zig::GlobalObject* globalObject, JSString* id, JSValue parent)
{
    if (!hasCompiledModules()) [[likely]]
        return parent;
    auto* requirer = dynamicDowncast<JSCommonJSModule>(parent);
    if (!requirer || !requirer->filename().isString())
        return parent;
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    JSString* pathOfRequirer = asString(requirer->filename());
    auto path = pathOfRequirer->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto required = id->value(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isCompiledModule(path) || isCompiledModule(required))
        return parent;
    RELEASE_AND_RETURN(scope, JSCommonJSModule::create(globalObject, pathOfRequirer, constructEmptyObject(globalObject), true, jsUndefined()));
}

static JSObject* createCodeNotCompiledError(JSGlobalObject* globalObject, const String& message)
{
    auto& vm = getVM(globalObject);
    JSObject* error = JSC::createError(globalObject, message);
    error->putDirect(vm, Identifier::fromString(vm, "code"_s), jsString(vm, String("ERR_CODE_NOT_COMPILED"_s)));
    return error;
}

JSValue errorIfUnseenCodeIsRefused(JSGlobalObject* globalObject, ASCIILiteral builtin)
{
    const AOT::Image* image = AOT::Image::current();
    if (!image || image->admitsUnknownJavaScript()) [[likely]]
        return {};
    return createCodeNotCompiledError(globalObject, makeString("Cannot use "_s, builtin, ": this executable only runs code that was compiled into it."_s));
}

bool isDebuggerAdmitted()
{
    const AOT::Image* image = AOT::Image::current();
    return !image || AOT::hasFlag(image->header().options.admitted(), AOT::AdmittedCode::Inspector);
}

JSValue errorIfDebuggerIsRefused(JSGlobalObject* globalObject, ASCIILiteral builtin)
{
    if (isDebuggerAdmitted()) [[likely]]
        return {};
    return createCodeNotCompiledError(globalObject, makeString("Cannot use "_s, builtin, ": rebuild this executable with --compile-inspector."_s));
}

bool compiledModulesRunInPlaceOfFiles()
{
    return hasCompiledModules() && Bun__compiledProgramRunsInPlace();
}

String firstCompiledModuleMatching(JSGlobalObject* globalObject, RegExp* filter)
{
    if (!compiledModulesRunInPlaceOfFiles())
        return {};
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    String found;
    AOT::forEachModule([&](AOT::ModuleID module) {
        String path = AOT::modulePath(module);
        auto matchResult = filter->match(globalObject, path, 0);
        RETURN_IF_EXCEPTION(scope, IterationStatus::Done);
        if (!matchResult)
            return IterationStatus::Continue;
        found = WTF::move(path);
        return IterationStatus::Done;
    });
    return found;
}

}

extern "C" bool Bun__refusesCodeOutsideExecutable(JSC::JSGlobalObject* globalObject)
{
    return Bun::hasCompiledModules() && JSC::AOT::refusesCodeOutsideImage(globalObject);
}

extern "C" bool Bun__isCompiledProgramFile(const BunString* path)
{
    return Bun::isCompiledModule(path->toWTFString(BunString::ZeroCopy));
}

// Start-up reads its options before the image is in use.
extern "C" bool Bun__AOT__omitsFunctionSource(BunAOTBytes image)
{
    std::span<const uint8_t> bytes { image.ptr, image.len };
    if (!JSC::AOT::Image::flags(bytes))
        return false;
    return reinterpret_cast<const JSC::AOT::ImageHeader*>(bytes.data())->options.omitsFunctionSource;
}

extern "C" bool Bun__AOT__entryPointIsCommonJS(JSC::JSGlobalObject* globalObject)
{
    return JSC::AOT::entryPointIsCommonJS(globalObject);
}

extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    return JSC::JSValue::encode(Bun::errorIfCodeOutsideImageIsRefused(globalObject, code, path->toWTFString(BunString::ZeroCopy)));
}

extern "C" JSC::EncodedJSValue Bun__AOT__errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject* globalObject, Bun::ErrorCode code, const BunString* path)
{
    return JSC::JSValue::encode(Bun::errorIfHostObjectOutsideImageIsRefused(globalObject, code, path->toWTFString(BunString::ZeroCopy)));
}

#else // ENABLE(AOT)

// The answers of the functions above where no image is registered.
namespace Bun {
using namespace JSC;

const AOT::ModuleHost compiledModuleHost {};

std::optional<AOT::ModuleID> compiledModuleForPath(const String&) { return std::nullopt; }
JSPromise* compiledModuleSource(Zig::GlobalObject*, const String&, bool) { return nullptr; }
JSPromise* importCompiledModule(Zig::GlobalObject*, const String&, bool, int64_t) { return nullptr; }
bool requireCompiledModule(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
JSValue loadCompiledModuleNamespace(Zig::GlobalObject*, const String&) { return {}; }
bool evaluateCompiledFileForDefaultLoader(Zig::GlobalObject*, JSCommonJSModule*, const String&, bool) { return false; }
bool compiledModulesRunInPlaceOfFiles() { return false; }
String firstCompiledModuleMatching(JSGlobalObject*, RegExp*) { return {}; }
JSValue createNotInExecutableError(JSGlobalObject* globalObject, ErrorCode code, const String& path, NotInExecutable)
{
    return createError(globalObject, code, makeString("Cannot load '"_s, path, "': it isn't in this executable."_s));
}
JSValue errorIfCodeOutsideImageIsRefused(JSGlobalObject*, ErrorCode, const String&) { return {}; }
JSValue errorIfHostObjectOutsideImageIsRefused(JSGlobalObject*, ErrorCode, const String&) { return {}; }
JSValue mainModuleOfExecutable(Zig::GlobalObject*) { return jsUndefined(); }
bool appendNewChildrenOfCompiledModule(JSGlobalObject*, JSCommonJSModule*) { return true; }
JSCommonJSModule* parentOfCompiledModule(JSCommonJSModule*) { return nullptr; }
JSValue parentSeenBy(Zig::GlobalObject*, JSString*, JSValue parent) { return parent; }
JSValue errorIfUnseenCodeIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
bool isDebuggerAdmitted() { return true; }
JSValue errorIfDebuggerIsRefused(JSGlobalObject*, ASCIILiteral) { return {}; }
void willSetRequireCacheEntry(Zig::GlobalObject*, const String&, JSValue) {}

}

extern "C" bool Bun__refusesCodeOutsideExecutable(JSC::JSGlobalObject*) { return false; }
extern "C" bool Bun__isCompiledProgramFile(const BunString*) { return false; }
extern "C" bool Bun__AOT__omitsFunctionSource(BunAOTBytes) { return false; }
extern "C" bool Bun__AOT__entryPointIsCommonJS(JSC::JSGlobalObject*) { return false; }
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfCodeOutsideImageIsRefused(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString*) { return JSC::JSValue::encode({}); }
extern "C" JSC::EncodedJSValue Bun__AOT__errorIfHostObjectOutsideImageIsRefused(JSC::JSGlobalObject*, Bun::ErrorCode, const BunString*) { return JSC::JSValue::encode({}); }

#endif // ENABLE(AOT)
