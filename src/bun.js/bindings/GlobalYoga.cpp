#include "root.h"
#include "ZigGlobalObject.h"
#include "JSYogaModule.h"
#include <JavaScriptCore/JSCInlines.h>

namespace Bun {

// This function would be called to expose Yoga as a global variable
extern "C" void Bun__exposeYogaGlobal(Zig::GlobalObject* globalObject)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_CATCH_SCOPE(vm);
    
    // Create the Yoga module
    JSC::JSValue yogaModule = Bun__createYogaModule(globalObject);
    
    // Expose it as globalThis.Yoga
    globalObject->putDirect(
        vm,
        JSC::Identifier::fromString(vm, "Yoga"_s),
        yogaModule,
        JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly
    );
    
    RETURN_IF_EXCEPTION(scope, void());
}

} // namespace Bun