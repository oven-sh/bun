#pragma once
#include "root.h"
#include "headers-handwritten.h"
#include "BunBuiltinNames.h"
#include "WebCoreJSBuiltins.h"

namespace Bun {
using namespace JSC;
using namespace WebCore;

// Forward declaration
class JSBakeResponse;
void setupJSBakeResponseClassStructure(JSC::LazyClassStructure::Initializer& init);

struct BakeAdditionsToGlobalObject {
    template<typename Visitor>
    void visit(Visitor& visitor)
    {
        this->m_JSBakeResponseClassStructure.visit(visitor);
        visitor.append(this->m_wrapComponent);
    }

    void initialize()
    {
        m_JSBakeResponseClassStructure.initLater(
            [](LazyClassStructure::Initializer& init) {
                Bun::setupJSBakeResponseClassStructure(init);
            });
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

private:
    WriteBarrier<JSFunction> m_wrapComponent;
};

} // namespace Bun
