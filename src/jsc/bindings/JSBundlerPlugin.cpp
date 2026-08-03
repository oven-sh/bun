#include "JSBundlerPlugin.h"

#include "BunProcess.h"
#include "../../../packages/bun-native-bundler-plugin-api/bundler_plugin.h"
#include "JavaScriptCore/CallData.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/TopExceptionScope.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/Structure.h>
#include "helpers.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/JSCInlines.h>
#include "JSFFIFunction.h"

#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <JavaScriptCore/RegExpObject.h>
#include <JavaScriptCore/JSPromise.h>
#include "BunClientData.h"
#include "ModuleLoader.h"
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/LazyProperty.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/VMTrapsInlines.h>
#include "ErrorCode.h"
#include "napi_external.h"
#include "WebCoreJSBuiltins.h"

#include <JavaScriptCore/JSPromise.h>

#if OS(WINDOWS)
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace Bun {

extern "C" void CrashHandler__setInsideNativePlugin(const char* plugin_name);
extern "C" int OnBeforeParsePlugin__isDone(void* context);
extern "C" void OnBeforeParseResult__reset(OnBeforeParseResult* result);
#define WRAP_BUNDLER_PLUGIN(argName) jsDoubleNumber(std::bit_cast<double>(reinterpret_cast<uintptr_t>(argName)))
#define UNWRAP_BUNDLER_PLUGIN(callFrame) reinterpret_cast<void*>(std::bit_cast<uintptr_t>(callFrame->argument(0).asDouble()))

/// These are native callbacks to be run after their associated JS version is run
extern "C" void JSBundlerPlugin__addError(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
extern "C" void JSBundlerPlugin__onLoadAsync(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
extern "C" void JSBundlerPlugin__onResolveAsync(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);
extern "C" void JSBundlerPlugin__onVirtualModulePlugin(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);
extern "C" JSC::EncodedJSValue JSBundlerPlugin__onDefer(void*, JSC::JSGlobalObject*);

JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_addFilter);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_addError);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_onLoadAsync);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_onResolveAsync);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_onBeforeParse);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_generateDeferPromise);

void BundlerPlugin::NamespaceList::append(JSC::VM& vm, JSC::RegExp* filter, String& namespaceString, unsigned& index)
{
    auto* nsGroup = group(namespaceString, index);

    if (nsGroup == nullptr) {
        namespaces.append(namespaceString);
        groups.append(Vector<FilterRegExp> {});
        nsGroup = &groups.last();
        index = namespaces.size() - 1;
    }

    auto pattern = filter->pattern();
    auto filter_regexp = FilterRegExp(pattern, filter->flags());
    nsGroup->append(WTF::move(filter_regexp));
}

static bool anyMatchesForNamespace(BundlerPlugin::NamespaceList& list, BunString* namespaceStr, BunString* path)
{
    auto namespaceString = namespaceStr ? namespaceStr->transferToWTFString() : String();
    auto pathString = path->transferToWTFString();

    if (list.fileNamespace.isEmpty() && list.namespaces.isEmpty())
        return false;

    unsigned index = 0;
    auto* group = list.group(namespaceString, index);
    if (group == nullptr) {
        return false;
    }

    auto& filters = *group;

    for (auto& filter : filters) {
        if (filter.match(pathString)) {
            return true;
        }
    }

    return false;
}
bool BundlerPlugin::anyMatchesCrossThread(BunString* namespaceStr, BunString* path, bool isOnLoad)
{
    if (isOnLoad) {
        return anyMatchesForNamespace(this->onLoad, namespaceStr, path);
    } else {
        return anyMatchesForNamespace(this->onResolve, namespaceStr, path);
    }
}

static const HashTableValue JSBundlerPluginHashTable[] = {
    { "addFilter"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_addFilter, 3 } },
    { "addError"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_addError, 3 } },
    { "onLoadAsync"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_onLoadAsync, 3 } },
    { "onResolveAsync"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_onResolveAsync, 4 } },
    { "onBeforeParse"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_onBeforeParse, 4 } },
    { "generateDeferPromise"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_generateDeferPromise, 0 } },
};

class JSBundlerPlugin final : public JSC::JSDestructibleObject {
public:
    using Base = JSC::JSDestructibleObject;
    static JSBundlerPlugin* create(JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure,
        void* config,
        BunPluginTarget target,
        JSBundlerPluginAddErrorCallback addError = JSBundlerPlugin__addError,
        JSBundlerPluginOnLoadAsyncCallback onLoadAsync = JSBundlerPlugin__onLoadAsync,
        JSBundlerPluginOnResolveAsyncCallback onResolveAsync = JSBundlerPlugin__onResolveAsync)
    {
        JSBundlerPlugin* ptr = new (NotNull, JSC::allocateCell<JSBundlerPlugin>(vm)) JSBundlerPlugin(vm, globalObject, structure, config, target,
            addError,
            onLoadAsync,
            onResolveAsync);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<JSBundlerPlugin, WebCore::UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForBundlerPlugin.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForBundlerPlugin = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForBundlerPlugin.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForBundlerPlugin = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    DECLARE_VISIT_CHILDREN;
    DECLARE_VISIT_OUTPUT_CONSTRAINTS;

    template<typename Visitor> void visitAdditionalChildrenInGCThread(Visitor&);

    Ref<Bun::BundlerPlugin> plugin;
    /// These are defined in BundlerPlugin.ts
    JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction> onLoadFunction;
    JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction> onResolveFunction;
    JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction> setupFunction;

    JSC::JSGlobalObject* m_globalObject;

    static void destroy(JSC::JSCell* cell)
    {
        JSBundlerPlugin* thisObject = static_cast<JSBundlerPlugin*>(cell);
        thisObject->~JSBundlerPlugin();
    }

private:
    JSBundlerPlugin(JSC::VM& vm, JSC::JSGlobalObject* global, JSC::Structure* structure, void* config, BunPluginTarget target,
        JSBundlerPluginAddErrorCallback addError, JSBundlerPluginOnLoadAsyncCallback onLoadAsync, JSBundlerPluginOnResolveAsyncCallback onResolveAsync)
        : Base(vm, structure)
        , plugin(BundlerPlugin::create(config, target, addError, onLoadAsync, onResolveAsync))
        , m_globalObject(global)
    {
        plugin->setCell(this);
    }

    ~JSBundlerPlugin() = default;
    void finishCreation(JSC::VM&);
};

template<typename Visitor>
void JSBundlerPlugin::visitAdditionalChildrenInGCThread(Visitor& visitor)
{
    this->onLoadFunction.visit(visitor);
    this->onResolveFunction.visit(visitor);
    this->setupFunction.visit(visitor);
    this->plugin->deferredPromises.visit(this, visitor);
    this->plugin->onBeforeParseExternals.visit(this, visitor);
}

template<typename Visitor>
void JSBundlerPlugin::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSBundlerPlugin* thisObject = uncheckedDowncast<JSBundlerPlugin>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    thisObject->visitAdditionalChildrenInGCThread(visitor);
}
DEFINE_VISIT_CHILDREN(JSBundlerPlugin);
DEFINE_VISIT_ADDITIONAL_CHILDREN_IN_GC_THREAD(JSBundlerPlugin);

template<typename Visitor>
void JSBundlerPlugin::visitOutputConstraintsImpl(JSCell* cell, Visitor& visitor)
{
    JSBundlerPlugin* thisObject = uncheckedDowncast<JSBundlerPlugin>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    thisObject->visitAdditionalChildrenInGCThread(visitor);
}
DEFINE_VISIT_OUTPUT_CONSTRAINTS(JSBundlerPlugin);

const JSC::ClassInfo JSBundlerPlugin::s_info = { "BundlerPlugin"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBundlerPlugin) };

/// `BundlerPlugin.prototype.addFilter(filter: RegExp, namespace: string, isOnLoad: 0 | 1): void`
JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_addFilter, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = uncheckedDowncast<JSBundlerPlugin>(callFrame->thisValue());
    if (thisObject->plugin->tombstoned) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::RegExpObject* regExp = uncheckedDowncast<JSC::RegExpObject>(callFrame->argument(0));
    WTF::String namespaceStr = callFrame->argument(1).toWTFString(globalObject);
    if (namespaceStr == "file"_s) {
        namespaceStr = String();
    }

    uint32_t isOnLoad = callFrame->argument(2).toUInt32(globalObject);
    auto& vm = JSC::getVM(globalObject);

    unsigned index = 0;
    if (isOnLoad) {
        thisObject->plugin->onLoad.append(vm, regExp->regExp(), namespaceStr, index);
    } else {
        thisObject->plugin->onResolve.append(vm, regExp->regExp(), namespaceStr, index);
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

void BundlerPlugin::NativePluginList::append(JSC::VM& vm, JSC::RegExp* filter, String& namespaceString, JSBundlerPluginNativeOnBeforeParseCallback callback, const char* name, void* externalValue)
{
    unsigned index = 0;

    {
        auto* nsGroup = group(namespaceString, index);

        if (nsGroup == nullptr) {
            namespaces.append(namespaceString);
            groups.append(Vector<FilterRegExp> {});
            nsGroup = &groups.last();
            index = namespaces.size() - 1;
        }

        auto pattern = filter->pattern();
        auto filter_regexp = FilterRegExp(pattern, filter->flags());
        nsGroup->append(WTF::move(filter_regexp));
    }

    if (index == std::numeric_limits<unsigned>::max()) {
        this->fileCallbacks.append(NativePluginCallback {
            callback,
            externalValue,
            name,
        });
    } else {
        if (this->namespaceCallbacks.size() <= index) {
            this->namespaceCallbacks.grow(index + 1);
        }
        this->namespaceCallbacks[index].append(NativePluginCallback { callback, externalValue, name });
    }
}

bool BundlerPlugin::FilterRegExp::match(const String& path)
{
    WTF::Locker locker { lock };
    return regex.match(path) != -1;
}

int BundlerPlugin::NativePluginList::call(BundlerPlugin* plugin, int* shouldContinue, void* bunContextPtr, const BunString* namespaceStr, const BunString* pathString, OnBeforeParseArguments* onBeforeParseArgs, OnBeforeParseResult* onBeforeParseResult)
{
    unsigned index = 0;
    auto* groupPtr = this->group(namespaceStr->toWTFString(BunString::ZeroCopy), index);
    if (groupPtr == nullptr) {
        return -1;
    }
    auto& filters = *groupPtr;

    const auto& callbacks = index == std::numeric_limits<unsigned>::max() ? this->fileCallbacks : this->namespaceCallbacks[index];
    ASSERT_WITH_MESSAGE(callbacks.size() == filters.size(), "Number of callbacks and filters must match");
    if (callbacks.isEmpty()) {
        return -1;
    }

    int count = 0;
    const WTF::String& path = pathString->toWTFString(BunString::ZeroCopy);
    for (size_t i = 0, total = callbacks.size(); i < total && *shouldContinue; ++i) {

        if (i > 0) {
            OnBeforeParseResult__reset(onBeforeParseResult);
        }

        if (filters[i].match(path)) {
            ASSERT(onBeforeParseArgs != nullptr);
            onBeforeParseArgs->external = callbacks[i].externalValue;

            JSBundlerPluginNativeOnBeforeParseCallback callback = callbacks[i].callback;
            const char* name = callbacks[i].name ? callbacks[i].name : "<unknown>";
            CrashHandler__setInsideNativePlugin(name);
            callback(onBeforeParseArgs, onBeforeParseResult);
            CrashHandler__setInsideNativePlugin(nullptr);

            count++;
        }

        if (OnBeforeParsePlugin__isDone(bunContextPtr)) {
            return count;
        }
    }

    return count;
}
JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_onBeforeParse, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSBundlerPlugin* thisObject = uncheckedDowncast<JSBundlerPlugin>(callFrame->thisValue());
    if (thisObject->plugin->tombstoned) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    // Clone the regexp so we don't have to worry about it being used concurrently with the JS thread.
    // TODO: Should we have a regexp object for every thread in the thread pool? Then we could avoid using
    // a mutex to synchronize access to the same regexp from multiple threads.
    JSC::RegExpObject* jsRegexp = uncheckedDowncast<JSC::RegExpObject>(callFrame->argument(0));
    RegExp* reggie = jsRegexp->regExp();
    RegExp* newRegexp = RegExp::create(vm, reggie->pattern(), reggie->flags());

    WTF::String namespaceStr = callFrame->argument(1).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    if (namespaceStr == "file"_s) {
        namespaceStr = String();
    }

    JSC::JSValue node_addon = callFrame->argument(2);
    if (!node_addon.isObject()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Expected node_addon (2nd argument) to be an object"_s);
        return {};
    }

    JSC::JSValue on_before_parse_symbol_js = callFrame->argument(3);
    if (!on_before_parse_symbol_js.isString()) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Expected on_before_parse_symbol (3rd argument) to be a string"_s);
        return {};
    }
    WTF::String on_before_parse_symbol = on_before_parse_symbol_js.toWTFString(globalObject);

    // The dlopen *void handle is attached to the node_addon as a NapiExternal
    Bun::NapiExternal* napi_external = dynamicDowncast<Bun::NapiExternal>(node_addon.getObject()->get(globalObject, WebCore::builtinNames(vm).napiDlopenHandlePrivateName()));
    if (!napi_external) [[unlikely]] {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Expected node_addon (2nd argument) to have a napiDlopenHandle property"_s);
        return {};
    }
    Bun::NapiModuleMeta* meta = (Bun::NapiModuleMeta*)napi_external->value();
    void* dlopen_handle = meta->dlopenHandle;
    CString utf8 = on_before_parse_symbol.utf8();

#if OS(WINDOWS)
    void* on_before_parse_symbol_ptr = GetProcAddress((HMODULE)dlopen_handle, utf8.data());
    const char** native_plugin_name = (const char**)GetProcAddress((HMODULE)dlopen_handle, "BUN_PLUGIN_NAME");
#else
    void* on_before_parse_symbol_ptr = dlsym(dlopen_handle, utf8.data());
    const char** native_plugin_name = (const char**)dlsym(dlopen_handle, "BUN_PLUGIN_NAME");
#endif

    if (!on_before_parse_symbol_ptr) {
        Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, makeString("Could not find the symbol \""_s, on_before_parse_symbol, "\" in the given napi module."_s));
        return {};
    }

    JSBundlerPluginNativeOnBeforeParseCallback callback = reinterpret_cast<JSBundlerPluginNativeOnBeforeParseCallback>(on_before_parse_symbol_ptr);

    JSC::JSValue external = callFrame->argument(4);
    void* externalValue = nullptr;
    if (!external.isUndefinedOrNull()) {
        NapiExternal* externalPtr = dynamicDowncast<Bun::NapiExternal>(external);
        if (!externalPtr) [[unlikely]] {
            Bun::throwError(globalObject, scope, ErrorCode::ERR_INVALID_ARG_TYPE, "Expected external (3rd argument) to be a NAPI external"_s);
            return {};
        }
        thisObject->plugin->onBeforeParseExternals.append(vm, thisObject, externalPtr);
        externalValue = externalPtr->value();
    }

    thisObject->plugin->onBeforeParse.append(vm, newRegexp, namespaceStr, callback, native_plugin_name ? *native_plugin_name : nullptr, externalValue);

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_addError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = uncheckedDowncast<JSBundlerPlugin>(callFrame->thisValue());
    if (!thisObject->plugin->tombstoned) {
        thisObject->plugin->addError(
            UNWRAP_BUNDLER_PLUGIN(callFrame),
            thisObject->plugin.ptr(),
            JSValue::encode(callFrame->argument(1)),
            JSValue::encode(callFrame->argument(2)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_onLoadAsync, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = uncheckedDowncast<JSBundlerPlugin>(callFrame->thisValue());
    if (!thisObject->plugin->tombstoned) {
        thisObject->plugin->onLoadAsync(
            UNWRAP_BUNDLER_PLUGIN(callFrame),
            thisObject->plugin->config,
            JSValue::encode(callFrame->argument(1)),
            JSValue::encode(callFrame->argument(2)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_onResolveAsync, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = uncheckedDowncast<JSBundlerPlugin>(callFrame->thisValue());
    if (!thisObject->plugin->tombstoned) {
        thisObject->plugin->onResolveAsync(
            UNWRAP_BUNDLER_PLUGIN(callFrame),
            thisObject->plugin->config,
            JSValue::encode(callFrame->argument(1)),
            JSValue::encode(callFrame->argument(2)),
            JSValue::encode(callFrame->argument(3)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

extern "C" JSC::EncodedJSValue JSBundlerPlugin__appendDeferPromise(Bun::BundlerPlugin* plugin)
{
    auto* cell = plugin->cell();
    auto* vm = &cell->vm();
    auto* globalObject = cell->globalObject();

    JSPromise* ret = JSPromise::create(*vm, globalObject->promiseStructure());
    plugin->deferredPromises.append(*vm, cell, ret);

    return JSC::JSValue::encode(ret);
}

JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_generateDeferPromise, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* plugin = (JSBundlerPlugin*)UNWRAP_BUNDLER_PLUGIN(callFrame);
    JSC::EncodedJSValue encoded_defer_promise = JSBundlerPlugin__onDefer(plugin, globalObject);
    return encoded_defer_promise;
}

void JSBundlerPlugin::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    this->onLoadFunction.initLater(
        [](const JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction>::Initializer& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();

            init.set(
                JSC::JSFunction::create(vm, globalObject, WebCore::bundlerPluginRunOnLoadPluginsCodeGenerator(vm), globalObject));
        });

    this->onResolveFunction.initLater(
        [](const JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction>::Initializer& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();

            init.set(
                JSC::JSFunction::create(vm, globalObject, WebCore::bundlerPluginRunOnResolvePluginsCodeGenerator(vm), globalObject));
        });

    this->setupFunction.initLater(
        [](const JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction>::Initializer& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();

            init.set(
                JSC::JSFunction::create(vm, globalObject, WebCore::bundlerPluginRunSetupFunctionCodeGenerator(vm), globalObject));
        });

    this->putDirect(vm, Identifier::fromString(vm, String("onLoad"_s)), jsUndefined(), 0);
    this->putDirect(vm, Identifier::fromString(vm, String("onResolve"_s)), jsUndefined(), 0);
    reifyStaticProperties(vm, JSBundlerPlugin::info(), JSBundlerPluginHashTable, *this);
}

extern "C" bool JSBundlerPlugin__anyMatches(Bun::BundlerPlugin* plugin, BunString* namespaceString, BunString* path, bool isOnLoad)
{
    return plugin->anyMatchesCrossThread(namespaceString, path, isOnLoad);
}

extern "C" void JSBundlerPlugin__matchOnLoad(Bun::BundlerPlugin* plugin, BunString* namespaceString, BunString* path, void* context, uint8_t defaultLoaderId, bool isServerSide)
{
    auto* cell = plugin->cell();
    JSC::JSGlobalObject* globalObject = cell->globalObject();

    JSFunction* function = cell->onLoadFunction.get(cell);
    if (!function) [[unlikely]]
        return;

    JSC::CallData callData = JSC::getCallData(function);

    if (callData.type == JSC::CallData::Type::None) [[unlikely]]
        return;

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(cell->vm());
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(WRAP_BUNDLER_PLUGIN(context));
    arguments.append(path->transferToJS(globalObject));
    RETURN_IF_EXCEPTION(scope, void());
    arguments.append(namespaceString->transferToJS(globalObject));
    RETURN_IF_EXCEPTION(scope, void());
    arguments.append(JSC::jsNumber(defaultLoaderId));
    arguments.append(JSC::jsBoolean(isServerSide));

    call(globalObject, function, callData, cell, arguments);

    if (scope.exception()) [[unlikely]] {
        auto exception = scope.exception();
        (void)scope.tryClearException();
        if (!plugin->tombstoned) {
            // which = 1 (Load). JSBundlerPlugin__addError casts ctx based on this value.
            plugin->addError(
                context,
                plugin,
                JSC::JSValue::encode(exception),
                JSValue::encode(jsNumber(1)));
        }
    }
}

extern "C" void JSBundlerPlugin__matchOnResolve(Bun::BundlerPlugin* plugin, BunString* namespaceString, BunString* path, BunString* importer, void* context, uint8_t kindId)
{
    auto* cell = plugin->cell();
    JSC::JSGlobalObject* globalObject = cell->globalObject();

    JSFunction* function = cell->onResolveFunction.get(cell);
    if (!function) [[unlikely]]
        return;

    JSC::CallData callData = JSC::getCallData(function);

    if (callData.type == JSC::CallData::Type::None) [[unlikely]]
        return;

    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(cell->vm());
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(path->transferToJS(globalObject));
    RETURN_IF_EXCEPTION(scope, void());
    arguments.append(namespaceString->transferToJS(globalObject));
    RETURN_IF_EXCEPTION(scope, void());
    arguments.append(importer->transferToJS(globalObject));
    RETURN_IF_EXCEPTION(scope, void());
    arguments.append(WRAP_BUNDLER_PLUGIN(context));
    arguments.append(JSC::jsNumber(kindId));

    call(globalObject, function, callData, cell, arguments);

    if (scope.exception()) [[unlikely]] {
        auto exception = JSValue(scope.exception());
        (void)scope.tryClearException();
        if (!plugin->tombstoned) {
            // which = 0 (Resolve). JSBundlerPlugin__addError casts ctx based on this value.
            plugin->addError(
                context,
                plugin,
                JSC::JSValue::encode(exception),
                JSValue::encode(jsNumber(0)));
        }
        return;
    }
}

// Returns +1 BundlerPlugin* and gcProtect's its owning cell; both released in __destroy.
extern "C" Bun::BundlerPlugin* JSBundlerPlugin__create(Zig::GlobalObject* globalObject, BunPluginTarget target)
{
    auto* cell = JSBundlerPlugin::create(
        globalObject->vm(),
        globalObject,
        // TODO: cache this structure on the global object
        JSBundlerPlugin::createStructure(
            globalObject->vm(),
            globalObject,
            globalObject->objectPrototype()),
        nullptr,
        target);
    JSC::gcProtect(cell);
    cell->plugin->ref();
    return cell->plugin.ptr();
}

extern "C" void JSBundlerPlugin__destroy(Bun::BundlerPlugin* plugin)
{
    plugin->tombstone();
    JSC::gcUnprotect(plugin->cell());
    plugin->deref();
}

extern "C" JSC::EncodedJSValue JSBundlerPlugin__loadAndResolvePluginsForServe(Bun::BundlerPlugin* plugin, JSC::EncodedJSValue encodedPlugins, JSC::EncodedJSValue encodedBunfigFolder)
{
    auto* cell = plugin->cell();
    auto& vm = cell->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* loadAndResolvePluginsForServeBuiltinFn = JSC::JSFunction::create(vm, cell->globalObject(), WebCore::bundlerPluginLoadAndResolvePluginsForServeCodeGenerator(vm), cell->globalObject());

    auto* runSetupFn = cell->setupFunction.get(cell);

    JSC::CallData callData = JSC::getCallData(loadAndResolvePluginsForServeBuiltinFn);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]]
        return JSValue::encode(jsUndefined());

    MarkedArgumentBuffer arguments;
    arguments.append(JSValue::decode(encodedPlugins));
    arguments.append(JSValue::decode(encodedBunfigFolder));
    arguments.append(runSetupFn);

    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::profiledCall(cell->globalObject(), ProfilingReason::API, loadAndResolvePluginsForServeBuiltinFn, callData, cell, arguments)));
}

extern "C" JSC::EncodedJSValue JSBundlerPlugin__runSetupFunction(
    Bun::BundlerPlugin* plugin,
    JSC::EncodedJSValue encodedSetupFunction,
    JSC::EncodedJSValue encodedConfig,
    JSC::EncodedJSValue encodedOnstartPromisesArray,
    JSC::EncodedJSValue encodedIsLast,
    JSC::EncodedJSValue encodedIsBake)
{
    auto* cell = plugin->cell();
    auto& vm = cell->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* setupFunction = cell->setupFunction.get(cell);
    if (!setupFunction) [[unlikely]]
        return JSValue::encode(jsUndefined());

    JSC::CallData callData = JSC::getCallData(setupFunction);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]]
        return JSValue::encode(jsUndefined());

    MarkedArgumentBuffer arguments;
    arguments.append(JSValue::decode(encodedSetupFunction));
    arguments.append(JSValue::decode(encodedConfig));
    arguments.append(JSValue::decode(encodedOnstartPromisesArray));
    arguments.append(JSValue::decode(encodedIsLast));
    arguments.append(JSValue::decode(encodedIsBake));
    auto* lexicalGlobalObject = uncheckedDowncast<JSFunction>(JSValue::decode(encodedSetupFunction))->globalObject();

    auto result = JSC::profiledCall(lexicalGlobalObject, ProfilingReason::API, setupFunction, callData, cell, arguments);
    RETURN_IF_EXCEPTION(scope, {}); // should be able to use RELEASE_AND_RETURN, no? observed it returning undefined with exception active

    return JSValue::encode(result);
}

extern "C" void JSBundlerPlugin__setConfig(Bun::BundlerPlugin* plugin, void* config)
{
    plugin->config = config;
}

extern "C" void JSBundlerPlugin__drainDeferred(Bun::BundlerPlugin* plugin, bool rejected)
{
    auto* cell = plugin->cell();
    auto* globalObject = cell->globalObject();
    MarkedArgumentBuffer arguments;
    plugin->deferredPromises.drainTo(cell, arguments);
    ASSERT(!arguments.hasOverflowed());

    auto& vm = cell->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    for (auto promiseValue : arguments) {
        JSPromise* promise = uncheckedDowncast<JSPromise>(promiseValue);
        if (rejected) {
            promise->reject(vm, JSC::jsUndefined());
        } else {
            promise->resolve(globalObject, vm, JSC::jsUndefined());
        }
        RETURN_IF_EXCEPTION(scope, );
    }
    RETURN_IF_EXCEPTION(scope, );
}

extern "C" JSC::EncodedJSValue JSBundlerPlugin__runOnEndCallbacks(Bun::BundlerPlugin* plugin, JSC::EncodedJSValue encodedBuildPromise, JSC::EncodedJSValue encodedBuildResult, JSC::EncodedJSValue encodedRejection)
{
    auto* cell = plugin->cell();
    auto& vm = cell->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = cell->globalObject();

    // TODO: have a prototype for JSBundlerPlugin that this is put on instead of re-creating the function on each usage
    auto* runOnEndCallbacksFn = JSC::JSFunction::create(vm, globalObject,
        WebCore::bundlerPluginRunOnEndCallbacksCodeGenerator(vm), globalObject);

    JSC::CallData callData = JSC::getCallData(runOnEndCallbacksFn);
    if (callData.type == JSC::CallData::Type::None) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }

    MarkedArgumentBuffer arguments;
    arguments.append(JSValue::decode(encodedBuildPromise));
    arguments.append(JSValue::decode(encodedBuildResult));
    arguments.append(JSValue::decode(encodedRejection));

    // TODO: use AsyncContextFrame?
    auto result
        = JSC::profiledCall(globalObject, ProfilingReason::API, runOnEndCallbacksFn, callData, cell, arguments);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(result);
}

extern "C" int JSBundlerPlugin__callOnBeforeParsePlugins(
    Bun::BundlerPlugin* plugin,
    void* bunContextPtr,
    const BunString* namespaceStr,
    const BunString* pathString,
    OnBeforeParseArguments* onBeforeParseArgs,
    OnBeforeParseResult* onBeforeParseResult,
    int* shouldContinue)
{
    return plugin->onBeforeParse.call(plugin, shouldContinue, bunContextPtr, namespaceStr, pathString, onBeforeParseArgs, onBeforeParseResult);
}

extern "C" int JSBundlerPlugin__hasOnBeforeParsePlugins(Bun::BundlerPlugin* plugin)
{
    return plugin->onBeforeParse.namespaceCallbacks.size() > 0 || plugin->onBeforeParse.fileCallbacks.size() > 0;
}

extern "C" JSC::JSGlobalObject* JSBundlerPlugin__globalObject(Bun::BundlerPlugin* plugin)
{
    return plugin->cell()->m_globalObject;
}

} // namespace Bun
