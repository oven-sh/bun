#include "BunWritableStreamConstructor.h"
#include "BunWritableStreamPrototype.h"
#include "BunWritableStream.h"
#include "BunWritableStreamDefaultController.h"
#include "ZigGlobalObject.h"

namespace Bun {

using namespace JSC;

// Constructor Implementation
const ClassInfo JSWritableStreamConstructor::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSWritableStreamConstructor) };

JSWritableStreamConstructor::JSWritableStreamConstructor(VM& vm, Structure* structure)
    : Base(vm, structure, call, construct)
{
}

JSWritableStreamConstructor* JSWritableStreamConstructor::create(VM& vm, JSGlobalObject* globalObject, Structure* structure, JSWritableStreamPrototype* prototype)
{
    JSWritableStreamConstructor* constructor = new (NotNull, allocateCell<JSWritableStreamConstructor>(vm)) JSWritableStreamConstructor(vm, structure);
    constructor->finishCreation(vm, globalObject, prototype);
    return constructor;
}

Structure* JSWritableStreamConstructor::createStructure(VM& vm, JSGlobalObject* globalObject, JSValue prototype)
{
    return Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), info());
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamConstructor, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue newTarget = callFrame->newTarget();
    if (newTarget.isUndefined())
        return throwVMTypeError(globalObject, scope, "WritableStream constructor must be called with 'new'"_s);

    JSObject* underlyingSink = callFrame->argument(0).getObject();
    JSValue strategy = callFrame->argument(1);
    auto* constructor = globalObject->writableStreamConstructor();
    auto* structure = globalObject->writableStreamStructure();

    if (!(!newTarget || newTarget != constructor)) {
        if (newTarget) {
            structure = JSC::InternalFunction::createSubclassStructure(getFunctionRealm(globalObject, newTarget.getObject()), newTarget.getObject(), structure);
        } else {
            structure = JSC::InternalFunction::createSubclassStructure(globalObject, constructor, structure);
        }
    }

    RETURN_IF_EXCEPTION(scope, {});

    JSWritableStream* stream = JSWritableStream::create(vm, lexicalGlobalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    // Initialize with underlying sink if provided
    if (underlyingSink) {
        // Set up controller with underlying sink...
        auto controller = JSWritableStreamDefaultController::create(vm, globalObject, stream, underlyingSink);
        RETURN_IF_EXCEPTION(scope, {});
        stream->setController(controller);
    }

    return JSValue::encode(stream);
}

JSC_DEFINE_HOST_FUNCTION(jsWritableStreamPrivateConstructor, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    // Similar to above but for internal usage
    VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    Structure* structure = defaultGlobalObject(globalObject)->writableStreamStructure();
    JSWritableStream* stream = JSWritableStream::create(vm, globalObject, structure);
    RETURN_IF_EXCEPTION(scope, {});

    return JSValue::encode(stream);
}

void JSWritableStreamConstructor::finishCreation(VM& vm, JSGlobalObject* globalObject, JSWritableStreamPrototype* prototype)
{
    Base::finishCreation(vm, 1, "WritableStream"_s, PropertyAdditionMode::WithStructureTransition);
    this->putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, 0);
}

} // namespace Bun
