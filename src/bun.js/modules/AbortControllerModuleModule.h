#pragma once

#include "JSAbortController.h"
#include "JSAbortSignal.h"

using namespace JSC;
using namespace WebCore;

namespace Zig {

inline void generateNativeModule_AbortControllerModule(
    JSC::JSGlobalObject* lexicalGlobalObject, JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{

    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);

    auto* abortController = WebCore::JSAbortController::getConstructor(vm, globalObject).getObject();
    JSValue abortSignal = WebCore::JSAbortSignal::getConstructor(vm, globalObject);

    const auto controllerIdent = Identifier::fromString(vm, "AbortController"_s);
    const auto signalIdent = Identifier::fromString(vm, "AbortSignal"_s);
    const Identifier& esModuleMarker = vm.propertyNames->__esModule;

    exportNames.append(vm.propertyNames->defaultKeyword);
    exportValues.append(abortController);

    exportNames.append(signalIdent);
    exportValues.append(abortSignal);

    exportNames.append(controllerIdent);
    exportValues.append(abortController);

    exportNames.append(esModuleMarker);
    exportValues.append(jsBoolean(true));

    // https://github.com/mysticatea/abort-controller/blob/a935d38e09eb95d6b633a8c42fcceec9969e7b05/dist/abort-controller.js#L125
    abortController->putDirect(
        vm, signalIdent, abortSignal,
        static_cast<unsigned>(PropertyAttribute::DontDelete));

    abortController->putDirect(
        vm, controllerIdent, abortController,
        static_cast<unsigned>(PropertyAttribute::DontDelete));

    abortController->putDirect(
        vm, vm.propertyNames->defaultKeyword, abortController,
        static_cast<unsigned>(PropertyAttribute::DontDelete));
}
} // namespace Zig
