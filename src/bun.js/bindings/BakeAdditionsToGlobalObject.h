#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BunBuiltinNames.h"
#include "WebCoreJSBuiltins.h"
#include "BakeProductionSSRRouteList.h"
#include "headers-handwritten.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

// Forward declaration
class JSBakeResponse;
void setupJSBakeResponseClassStructure(JSC::LazyClassStructure::Initializer& init);

BUN_DECLARE_HOST_FUNCTION(jsFunctionBakeGetAsyncLocalStorage);
BUN_DECLARE_HOST_FUNCTION(jsFunctionBakeEnsureAsyncLocalStorage);
BUN_DECLARE_HOST_FUNCTION(jsFunctionBakeGetBundleNewRouteJSFunction);

extern "C" JSC::EncodedJSValue Bake__getEnsureAsyncLocalStorageInstanceJSFunction(JSC::JSGlobalObject* globalObject);
extern "C" JSC::EncodedJSValue Bake__getAsyncLocalStorage(JSC::JSGlobalObject* globalObject);

extern "C" EncodedJSValue Bake__createFrameworkRequestArgsObject(JSC::JSGlobalObject* globalObject, EncodedJSValue routerTypeMain, EncodedJSValue routeModules, EncodedJSValue clientEntryUrl, EncodedJSValue styles, EncodedJSValue params);

void createFrameworkRequestArgsStructure(JSC::LazyClassStructure::Initializer& init);

extern "C" SYSV_ABI JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES Bake__getDevNewRouteParamsJSFunctionImpl(JSC::JSGlobalObject*, JSC::CallFrame*);

struct BakeAdditionsToGlobalObject {
    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        this->m_JSBakeResponseClassStructure.visit(visitor);
        this->m_FrameworkRequestArgsClassStructure.visit(visitor);
        visitor.append(this->m_wrapComponent);
        visitor.append(this->m_asyncLocalStorageInstance);

        this->m_bakeGetAsyncLocalStorage.visit(visitor);
        this->m_bakeEnsureAsyncLocalStorage.visit(visitor);
        this->m_bakeGetBundleNewRoute.visit(visitor);
        this->m_bakeGetDevNewRouteParamsJSFunction.visit(visitor);
    }

    void initialize()
    {
        m_JSBakeResponseClassStructure.initLater(
            [](LazyClassStructure::Initializer& init) {
                Bun::setupJSBakeResponseClassStructure(init);
            });

        m_bakeGetAsyncLocalStorage.initLater(
            [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
                init.set(JSFunction::create(init.vm, init.owner, 0, String("bakeGetAsyncLocalStorage"_s), jsFunctionBakeGetAsyncLocalStorage, ImplementationVisibility::Public, NoIntrinsic));
            });

        m_bakeEnsureAsyncLocalStorage.initLater(
            [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
                init.set(JSFunction::create(init.vm, init.owner, 1, String("bakeSetAsyncLocalStorage"_s), jsFunctionBakeEnsureAsyncLocalStorage, ImplementationVisibility::Public, NoIntrinsic));
            });

        m_BakeProductionSSRRouteInfoClassStructure.initLater(
            [](LazyClassStructure::Initializer& init) {
                Bun::createBakeProductionSSRRouteInfoStructure(init);
            });

        m_BakeProductionSSRRouteArgsClassStructure.initLater(
            [](LazyClassStructure::Initializer& init) {
                Bun::createBakeProductionSSRRouteArgsStructure(init);
            });

        m_bakeGetBundleNewRoute.initLater(
            [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
                init.set(JSFunction::create(init.vm, init.owner, 1, String("bundleNewRoute"_s), jsFunctionBakeGetBundleNewRouteJSFunction, ImplementationVisibility::Public, NoIntrinsic));
            });

        m_bakeGetDevNewRouteParamsJSFunction.initLater(
            [](const LazyProperty<JSGlobalObject, JSFunction>::Initializer& init) {
                init.set(JSFunction::create(init.vm, init.owner, 1, String("newRouteParams"_s), Bake__getDevNewRouteParamsJSFunctionImpl, ImplementationVisibility::Public, NoIntrinsic));
            });

        m_FrameworkRequestArgsClassStructure.initLater(
            [](LazyClassStructure::Initializer& init) {
                Bun::createFrameworkRequestArgsStructure(init);
            });
    }

    JSValue getBundleNewRouteJSFunction(JSGlobalObject* globalObject)
    {
        return m_bakeGetBundleNewRoute.get(globalObject);
    }

    JSValue getDevNewRouteParamsJSFunction(JSGlobalObject* globalObject)
    {
        return m_bakeGetDevNewRouteParamsJSFunction.get(globalObject);
    }

    void ensureAsyncLocalStorageInstance(JSGlobalObject* globalObject, JSValue asyncLocalStorage)
    {
        m_asyncLocalStorageInstance.set(globalObject->vm(), globalObject, asyncLocalStorage);
    }

    JSValue ensureAsyncLocalStorageInstanceJSFunction(const JSGlobalObject* globalObject)
    {
        return m_bakeEnsureAsyncLocalStorage.get(globalObject);
    }

    JSValue getAsyncLocalStorage(JSGlobalObject* globalObject)
    {
        return m_asyncLocalStorageInstance.get();
    }

    JSC::JSFunction* wrapComponent(JSGlobalObject* globalObject)
    {
        auto* function = m_wrapComponent.get();
        if (!function) {
            auto& vm = globalObject->vm();
            function = JSC::JSFunction::create(vm, globalObject, WebCore::bakeSSRResponseWrapComponentCodeGenerator(vm), globalObject);
            m_wrapComponent.set(vm, globalObject, function);
        }
        return function;
    }

    template<typename T>
    using LazyPropertyOfGlobalObject = LazyProperty<JSGlobalObject, T>;

    JSC::JSObject* JSBakeResponseConstructor(const JSGlobalObject* global) const { return m_JSBakeResponseClassStructure.constructorInitializedOnMainThread(global); }
    JSC::Structure* JSBakeResponseStructure(const JSGlobalObject* global) const { return m_JSBakeResponseClassStructure.getInitializedOnMainThread(global); }

    JSC::Symbol* reactLegacyElementSymbol(const JSGlobalObject* global) const
    {
        auto& vm = global->vm();
        return JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey("react.element"_s));
    }

    JSC::Symbol* reactElementSymbol(const JSGlobalObject* global) const
    {
        auto& vm = global->vm();
        return JSC::Symbol::create(vm, vm.symbolRegistry().symbolForKey("react.transitional.element"_s));
    }

    LazyClassStructure m_JSBakeResponseClassStructure;
    LazyClassStructure m_BakeProductionSSRRouteInfoClassStructure;
    LazyClassStructure m_BakeProductionSSRRouteArgsClassStructure;
    LazyClassStructure m_FrameworkRequestArgsClassStructure;

private:
    WriteBarrier<JSFunction> m_wrapComponent;

    WriteBarrier<Unknown> m_asyncLocalStorageInstance;
    LazyProperty<JSGlobalObject, JSFunction> m_bakeGetAsyncLocalStorage;
    LazyProperty<JSGlobalObject, JSFunction> m_bakeEnsureAsyncLocalStorage;
    LazyProperty<JSGlobalObject, JSFunction> m_bakeGetBundleNewRoute;
    LazyProperty<JSGlobalObject, JSFunction> m_bakeGetDevNewRouteParamsJSFunction;
};

} // namespace Bun
