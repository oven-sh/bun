#include "JSBundlerPlugin.h"

#include "headers-handwritten.h"
#include <JavaScriptCore/CatchScope.h>
#include <JavaScriptCore/JSGlobalObject.h>
#include <JavaScriptCore/JSTypeInfo.h>
#include <JavaScriptCore/Structure.h>
#include "helpers.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JavaScript.h>
#include <JavaScriptCore/JSObjectInlines.h>
#include <wtf/text/WTFString.h>
#include <JavaScriptCore/JSCInlines.h>

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
#include <JavaScriptCore/YarrMatchingContextHolder.h>
namespace Bun {

#define WRAP_BUNDLER_PLUGIN(argName) jsNumber(bitwise_cast<double>(reinterpret_cast<uintptr_t>(argName)))
#define UNWRAP_BUNDLER_PLUGIN(callFrame) reinterpret_cast<void*>(bitwise_cast<uintptr_t>(callFrame->argument(0).asDouble()))

extern "C" void JSBundlerPlugin__addError(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
extern "C" void JSBundlerPlugin__onLoadAsync(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue);
extern "C" void JSBundlerPlugin__onResolveAsync(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);
extern "C" void JSBundlerPlugin__onVirtualModulePlugin(void*, void*, JSC::EncodedJSValue, JSC::EncodedJSValue, JSC::EncodedJSValue);

JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_addFilter);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_addError);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_onLoadAsync);
JSC_DECLARE_HOST_FUNCTION(jsBundlerPluginFunction_onResolveAsync);

void BundlerPlugin::NamespaceList::append(JSC::VM& vm, JSC::RegExp* filter, String& namespaceString)
{
    auto* nsGroup = group(namespaceString);

    if (nsGroup == nullptr) {
        namespaces.append(namespaceString);
        groups.append(Vector<Yarr::RegularExpression> {});
        nsGroup = &groups.last();
    }

    Yarr::RegularExpression regex(
        StringView(filter->pattern()),
        filter->flags());

    nsGroup->append(WTFMove(regex));
}

bool BundlerPlugin::anyMatchesCrossThread(JSC::VM& vm, const BunString* namespaceStr, const BunString* path, bool isOnLoad)
{
    constexpr bool usesPatternContextBuffer = false;
    if (isOnLoad) {
        if (this->onLoad.fileNamespace.isEmpty() && this->onLoad.namespaces.isEmpty())
            return false;

        // Avoid unnecessary string copies
        auto namespaceString = namespaceStr ? namespaceStr->toWTFString(BunString::ZeroCopy) : String();

        auto* group = this->onLoad.group(namespaceString);
        if (group == nullptr) {
            return false;
        }

        auto& filters = *group;
        auto pathString = path->toWTFString(BunString::ZeroCopy);

        for (auto& filter : filters) {
            Yarr::MatchingContextHolder regExpContext(vm, usesPatternContextBuffer, nullptr, Yarr::MatchFrom::CompilerThread);
            if (filter.match(pathString) > -1) {
                return true;
            }
        }

    } else {
        if (this->onResolve.fileNamespace.isEmpty() && this->onResolve.namespaces.isEmpty())
            return false;

        // Avoid unnecessary string copies
        auto namespaceString = namespaceStr ? namespaceStr->toWTFString(BunString::ZeroCopy) : String();

        auto* group = this->onResolve.group(namespaceString);
        if (group == nullptr) {
            return false;
        }

        auto pathString = path->toWTFString(BunString::ZeroCopy);
        auto& filters = *group;

        for (auto& filter : filters) {
            Yarr::MatchingContextHolder regExpContext(vm, usesPatternContextBuffer, nullptr, Yarr::MatchFrom::CompilerThread);
            if (filter.match(pathString) > -1) {
                return true;
            }
        }
    }

    return false;
}

static const HashTableValue JSBundlerPluginHashTable[] = {
    { "addFilter"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_addFilter, 3 } },
    { "addError"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_addError, 3 } },
    { "onLoadAsync"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_onLoadAsync, 3 } },
    { "onResolveAsync"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::NativeFunctionType, jsBundlerPluginFunction_onResolveAsync, 4 } },
};

class JSBundlerPlugin final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
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

    Bun::BundlerPlugin plugin;
    JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction> onLoadFunction;
    JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction> onResolveFunction;
    JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction> moduleFunction;
    JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction> setupFunction;

private:
    JSBundlerPlugin(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure, void* config, BunPluginTarget target,
        JSBundlerPluginAddErrorCallback addError, JSBundlerPluginOnLoadAsyncCallback onLoadAsync, JSBundlerPluginOnResolveAsyncCallback onResolveAsync)
        : JSC::JSNonFinalObject(vm, structure)
        , plugin(BundlerPlugin(config, target, addError, onLoadAsync, onResolveAsync))
    {
    }

    void finishCreation(JSC::VM&);
};

template<typename Visitor>
void JSBundlerPlugin::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSBundlerPlugin* thisObject = jsCast<JSBundlerPlugin*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    thisObject->onLoadFunction.visit(visitor);
    thisObject->onResolveFunction.visit(visitor);
    thisObject->setupFunction.visit(visitor);
}
DEFINE_VISIT_CHILDREN(JSBundlerPlugin);

const JSC::ClassInfo JSBundlerPlugin::s_info = { "BundlerPlugin"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSBundlerPlugin) };

JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_addFilter, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = jsCast<JSBundlerPlugin*>(callFrame->thisValue());
    if (thisObject->plugin.tombstoned) {
        return JSC::JSValue::encode(JSC::jsUndefined());
    }

    JSC::RegExpObject* regExp = jsCast<JSC::RegExpObject*>(callFrame->argument(0));
    WTF::String namespaceStr = callFrame->argument(1).toWTFString(globalObject);
    if (namespaceStr == "file"_s) {
        namespaceStr = String();
    }

    bool isOnLoad = callFrame->argument(2).toNumber(globalObject) == 1;
    auto& vm = globalObject->vm();

    if (isOnLoad) {
        thisObject->plugin.onLoad.append(vm, regExp->regExp(), namespaceStr);
    } else {
        thisObject->plugin.onResolve.append(vm, regExp->regExp(), namespaceStr);
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_addError, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = jsCast<JSBundlerPlugin*>(callFrame->thisValue());
    if (!thisObject->plugin.tombstoned) {
        thisObject->plugin.addError(
            UNWRAP_BUNDLER_PLUGIN(callFrame),
            thisObject->plugin.config,
            JSValue::encode(callFrame->argument(1)),
            JSValue::encode(callFrame->argument(2)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_onLoadAsync, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = jsCast<JSBundlerPlugin*>(callFrame->thisValue());
    if (!thisObject->plugin.tombstoned) {
        thisObject->plugin.onLoadAsync(
            UNWRAP_BUNDLER_PLUGIN(callFrame),
            thisObject->plugin.config,
            JSValue::encode(callFrame->argument(1)),
            JSValue::encode(callFrame->argument(2)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
}
JSC_DEFINE_HOST_FUNCTION(jsBundlerPluginFunction_onResolveAsync, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSBundlerPlugin* thisObject = jsCast<JSBundlerPlugin*>(callFrame->thisValue());
    if (!thisObject->plugin.tombstoned) {
        thisObject->plugin.onResolveAsync(
            UNWRAP_BUNDLER_PLUGIN(callFrame),
            thisObject->plugin.config,
            JSValue::encode(callFrame->argument(1)),
            JSValue::encode(callFrame->argument(2)),
            JSValue::encode(callFrame->argument(3)));
    }

    return JSC::JSValue::encode(JSC::jsUndefined());
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
                JSC::JSFunction::create(vm, WebCore::bundlerPluginRunOnLoadPluginsCodeGenerator(vm), globalObject));
        });

    this->onResolveFunction.initLater(
        [](const JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction>::Initializer& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();

            init.set(
                JSC::JSFunction::create(vm, WebCore::bundlerPluginRunOnResolvePluginsCodeGenerator(vm), globalObject));
        });

    this->setupFunction.initLater(
        [](const JSC::LazyProperty<JSBundlerPlugin, JSC::JSFunction>::Initializer& init) {
            auto& vm = init.vm;
            auto* globalObject = init.owner->globalObject();

            init.set(
                JSC::JSFunction::create(vm, WebCore::bundlerPluginRunSetupFunctionCodeGenerator(vm), globalObject));
        });

    this->putDirect(vm, Identifier::fromString(vm, String("onLoad"_s)), jsUndefined(), 0);
    this->putDirect(vm, Identifier::fromString(vm, String("onResolve"_s)), jsUndefined(), 0);
    reifyStaticProperties(vm, JSBundlerPlugin::info(), JSBundlerPluginHashTable, *this);
}

extern "C" bool JSBundlerPlugin__anyMatches(Bun::JSBundlerPlugin* pluginObject, const BunString* namespaceString, const BunString* path, bool isOnLoad)
{
    return pluginObject->plugin.anyMatchesCrossThread(pluginObject->vm(), namespaceString, path, isOnLoad);
}

extern "C" void JSBundlerPlugin__matchOnLoad(JSC::JSGlobalObject* globalObject, Bun::JSBundlerPlugin* plugin, const BunString* namespaceString, const BunString* path, void* context, uint8_t defaultLoaderId)
{
    WTF::String namespaceStringStr = namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : WTF::String();
    WTF::String pathStr = path ? path->toWTFString(BunString::ZeroCopy) : WTF::String();

    JSFunction* function = plugin->onLoadFunction.get(plugin);
    if (UNLIKELY(!function))
        return;

    JSC::CallData callData = JSC::getCallData(function);

    if (UNLIKELY(callData.type == JSC::CallData::Type::None))
        return;

    auto scope = DECLARE_CATCH_SCOPE(plugin->vm());
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(WRAP_BUNDLER_PLUGIN(context));
    arguments.append(JSC::jsString(plugin->vm(), pathStr));
    arguments.append(JSC::jsString(plugin->vm(), namespaceStringStr));
    arguments.append(JSC::jsNumber(defaultLoaderId));

    call(globalObject, function, callData, plugin, arguments);

    if (scope.exception()) {
        auto exception = scope.exception();
        scope.clearException();
        if (!plugin->plugin.tombstoned) {
            plugin->plugin.addError(
                context,
                plugin->plugin.config,
                JSC::JSValue::encode(exception),
                JSValue::encode(jsNumber(0)));
        }
    }
}

extern "C" void JSBundlerPlugin__matchOnResolve(JSC::JSGlobalObject* globalObject, Bun::JSBundlerPlugin* plugin, const BunString* namespaceString, const BunString* path, const BunString* importer, void* context, uint8_t kindId)
{
    WTF::String namespaceStringStr = namespaceString ? namespaceString->toWTFString(BunString::ZeroCopy) : WTF::String("file"_s);
    if (namespaceStringStr.length() == 0) {
        namespaceStringStr = WTF::String("file"_s);
    }
    WTF::String pathStr = path ? path->toWTFString(BunString::ZeroCopy) : WTF::String();
    WTF::String importerStr = importer ? importer->toWTFString(BunString::ZeroCopy) : WTF::String();
    auto& vm = globalObject->vm();

    JSFunction* function = plugin->onResolveFunction.get(plugin);
    if (UNLIKELY(!function))
        return;

    JSC::CallData callData = JSC::getCallData(function);

    if (UNLIKELY(callData.type == JSC::CallData::Type::None))
        return;

    auto scope = DECLARE_CATCH_SCOPE(vm);
    JSC::MarkedArgumentBuffer arguments;
    arguments.append(JSC::jsString(vm, pathStr));
    arguments.append(JSC::jsString(vm, namespaceStringStr));
    arguments.append(JSC::jsString(vm, importerStr));
    arguments.append(WRAP_BUNDLER_PLUGIN(context));
    arguments.append(JSC::jsNumber(kindId));

    call(globalObject, function, callData, plugin, arguments);

    if (UNLIKELY(scope.exception())) {
        auto exception = JSValue(scope.exception());
        scope.clearException();
        if (!plugin->plugin.tombstoned) {
            JSBundlerPlugin__addError(
                context,
                plugin->plugin.config,
                JSC::JSValue::encode(exception),
                JSValue::encode(jsNumber(1)));
        }
        return;
    }
}

extern "C" Bun::JSBundlerPlugin* JSBundlerPlugin__create(Zig::GlobalObject* globalObject, BunPluginTarget target)
{
    return JSBundlerPlugin::create(
        globalObject->vm(),
        globalObject,
        // TODO: cache this structure on the global object
        JSBundlerPlugin::createStructure(
            globalObject->vm(),
            globalObject,
            globalObject->objectPrototype()),
        nullptr,
        target);
}

extern "C" JSC::EncodedJSValue JSBundlerPlugin__runSetupFunction(
    Bun::JSBundlerPlugin* plugin,
    JSC::EncodedJSValue encodedSetupFunction,
    JSC::EncodedJSValue encodedConfig)
{
    auto& vm = plugin->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);

    auto* setupFunction = jsCast<JSFunction*>(plugin->setupFunction.get(plugin));
    if (UNLIKELY(!setupFunction))
        return JSValue::encode(jsUndefined());

    JSC::CallData callData = JSC::getCallData(setupFunction);
    if (UNLIKELY(callData.type == JSC::CallData::Type::None))
        return JSValue::encode(jsUndefined());

    MarkedArgumentBuffer arguments;
    arguments.append(JSValue::decode(encodedSetupFunction));
    arguments.append(JSValue::decode(encodedConfig));
    auto* lexicalGlobalObject = jsCast<JSFunction*>(JSValue::decode(encodedSetupFunction))->globalObject();

    auto result = call(lexicalGlobalObject, setupFunction, callData, plugin, arguments);
    if (UNLIKELY(scope.exception())) {
        auto exception = scope.exception();
        scope.clearException();
        return JSValue::encode(exception);
    }

    return JSValue::encode(result);
}

extern "C" void JSBundlerPlugin__setConfig(Bun::JSBundlerPlugin* plugin, void* config)
{
    plugin->plugin.config = config;
}

extern "C" void JSBundlerPlugin__tombestone(Bun::JSBundlerPlugin* plugin)
{
    plugin->plugin.tombstone();
}

} // namespace Bun
