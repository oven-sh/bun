#include "root.h"

#include "ErrorStackTrace.h"
#include "GeneratedExpectDeferred.h"
#include "ZigGlobalObject.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/ErrorInstance.h>
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/StackFrame.h>

using namespace JSC;

// The `expect` of "vitest": the constructor of Expect again, with another function for a call. It inherits from that constructor from the start, because `bun test --aot` refuses to change the prototype of a native function.
class JSExpectOfVitest final : public InternalFunction {
public:
    using Base = InternalFunction;
    DECLARE_INFO;

    template<typename CellType, SubspaceAccess>
    static GCClient::IsoSubspace* subspaceFor(VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    static JSExpectOfVitest* create(VM& vm, JSGlobalObject* globalObject, InternalFunction* constructor, NativeFunction call)
    {
        auto* structure = Bun::createClassStructure(vm, globalObject, constructor, TypeInfo(InternalFunctionType, StructureFlags), info());
        auto construct = constructor->nativeFunctionFor(CodeSpecializationKind::CodeForConstruct).retagged<CFunctionPtrTag>();
        auto* function = new (NotNull, allocateCell<JSExpectOfVitest>(vm)) JSExpectOfVitest(vm, structure, call, construct);
        function->finishCreation(vm, 0, constructor->name(), PropertyAdditionMode::WithoutStructureTransition);
        return function;
    }

private:
    JSExpectOfVitest(VM& vm, Structure* structure, NativeFunction call, NativeFunction construct)
        : Base(vm, structure, call, construct)
    {
    }
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSExpectOfVitest, InternalFunction);

const ClassInfo JSExpectOfVitest::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSExpectOfVitest) };

extern "C" EncodedJSValue Expect__createOfVitest(JSGlobalObject* globalObject, EncodedJSValue encodedConstructor, NativeFunction call, NativeFunction soft, NativeFunction poll)
{
    auto& vm = getVM(globalObject);
    auto* constructor = uncheckedDowncast<InternalFunction>(JSValue::decode(encodedConstructor));
    auto* expect = JSExpectOfVitest::create(vm, globalObject, constructor, call);
    Identifier softName = Identifier::fromString(vm, "soft"_s);
    Identifier pollName = Identifier::fromString(vm, "poll"_s);
    JSValue softOfVitest = JSFunction::create(vm, globalObject, 1, softName.string(), soft, ImplementationVisibility::Public);
    JSValue pollOfVitest = JSFunction::create(vm, globalObject, 1, pollName.string(), poll, ImplementationVisibility::Public);
    // It has the members of the constructor itself, so that Object.assign() and a spread copy them from it too.
    constructor->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
        UniquedStringImpl* key = entry.key();
        if (key == vm.propertyNames->name.impl() || key == vm.propertyNames->length.impl())
            return true;
        JSValue value = constructor->getDirect(entry.offset());
        if (key == softName.impl())
            value = softOfVitest;
        else if (key == pollName.impl())
            value = pollOfVitest;
        if (entry.attributes() & PropertyAttribute::Accessor)
            expect->putDirectNonIndexAccessorWithoutTransition(vm, key, uncheckedDowncast<GetterSetter>(value), entry.attributes());
        else if (value.isCustomGetterSetter())
            expect->putDirectCustomGetterSetterWithoutTransition(vm, key, value, entry.attributes());
        else
            expect->putDirectWithoutTransition(vm, key, value, entry.attributes());
        return true;
    });
    return JSValue::encode(expect);
}

// The `expect` of "vitest" in this realm, or empty if its module was not made or has another `expect` now.
extern "C" EncodedJSValue Expect__ofVitestIfMade(JSGlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    JSObject* module = defaultGlobalObject(globalObject)->nativeModuleDefaultObject(NativeModuleDefaultSlot::BunTestVitest).get();
    if (!module)
        return {};
    JSValue expect = module->getDirect(vm, Identifier::fromString(vm, "expect"_s));
    return JSValue::encode(expect && expect.inherits<JSExpectOfVitest>() ? expect : JSValue());
}

extern "C" void ExpectDeferred__callWhenSettled(JSGlobalObject* globalObject, EncodedJSValue promise, EncodedJSValue function, EncodedJSValue deferred)
{
    JSValue callback = JSValue::decode(function);
    uncheckedDowncast<JSPromise>(JSValue::decode(promise))->performPromiseThenWithContext(getVM(globalObject), globalObject, callback, callback, jsUndefined(), JSValue::decode(deferred));
}

// `promise.then(onFulfilled)` without going through Promise.prototype, which user code can patch.
extern "C" EncodedJSValue ExpectDeferred__then(JSGlobalObject* globalObject, EncodedJSValue promise, EncodedJSValue onFulfilled)
{
    auto& vm = getVM(globalObject);
    auto* result = JSPromise::create(vm, globalObject->promiseStructure());
    uncheckedDowncast<JSPromise>(JSValue::decode(promise))->performPromiseThen(vm, globalObject, JSValue::decode(onFulfilled), jsUndefined(), result);
    return JSValue::encode(result);
}

extern "C" EncodedJSValue ExpectDeferred__takeThrown(JSGlobalObject* globalObject)
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(getVM(globalObject));
    auto* exception = scope.exception();
    if (!exception)
        return {};
    JSValue thrown = exception->value();
    if (!dynamicDowncast<Bun::Bindgen::Generated::JSExpectDeferred>(thrown))
        return {};
    (void)scope.tryClearException();
    return JSValue::encode(thrown);
}

extern "C" void ExpectDeferred__setCauseIfNone(JSGlobalObject* globalObject, EncodedJSValue error, EncodedJSValue cause)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    auto* object = JSValue::decode(error).getObject();
    if (!object)
        return;
    JSValue existing = object->get(globalObject, vm.propertyNames->cause);
    if (!scope.exception() && existing.isUndefinedOrNull()) {
        PutPropertySlot slot(object);
        object->methodTable()->put(object, globalObject, vm.propertyNames->cause, JSValue::decode(cause), slot);
    }
    if (scope.exception())
        (void)scope.tryClearException();
}

extern "C" bool ExpectDeferred__isHandled(EncodedJSValue promise)
{
    return uncheckedDowncast<JSPromise>(JSValue::decode(promise))->isHandled();
}

// A JSC::Exception, because unlike an Error it keeps its stack frames' code alive.
extern "C" EncodedJSValue ExpectDeferred__captureCallSite(JSGlobalObject* globalObject)
{
    return JSValue::encode(JSC::Exception::create(getVM(globalObject), jsUndefined()));
}

// Rewrites `error`'s stack as if the matcher had thrown synchronously at `callSite`.
extern "C" void ExpectDeferred__continueStackAt(JSGlobalObject* globalObject, EncodedJSValue encodedError, EncodedJSValue callSite)
{
    auto* error = dynamicDowncast<ErrorInstance>(JSValue::decode(encodedError));
    if (!error || error->hasMaterializedErrorInfo())
        return;
    Vector<StackFrame> frames;
    if (auto* thrownFrom = error->stackTrace()) {
        size_t insideMatcher = 0;
        for (size_t i = 0; i < thrownFrom->size(); i++) {
            if (thrownFrom->at(i).hasLineAndColumnInfo() && !thrownFrom->at(i).isAsyncFrame())
                insideMatcher = i + 1;
        }
        frames.append(thrownFrom->span().first(insideMatcher));
    }
    frames.appendVector(uncheckedDowncast<JSC::Exception>(JSValue::decode(callSite))->stack());
    frames.shrink(std::min<size_t>(frames.size(), globalObject->stackTraceLimit().value_or(0)));
    error->setStackFrames(getVM(globalObject), WTF::move(frames));
}

extern "C" void ExpectDeferred__location(JSGlobalObject* globalObject, EncodedJSValue callSite, BunString* outSourceURL, unsigned* outLine, unsigned* outColumn)
{
    auto& vm = getVM(globalObject);
    for (const StackFrame& frame : uncheckedDowncast<JSC::Exception>(JSValue::decode(callSite))->stack()) {
        if (Zig::isImplementationVisibilityPrivate(frame) || !frame.hasLineAndColumnInfo())
            continue;
        LineColumn lineColumn = frame.computeLineAndColumn();
        Bun::OwnedZigStackFrames remapped(1);
        remapped[0].position.line_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.line).zeroBasedInt();
        remapped[0].position.column_zero_based = OrdinalNumber::fromOneBasedInt(lineColumn.column).zeroBasedInt();
        remapped[0].source_url = Bun::toStringRef(Zig::sourceURL(vm, frame));
        remapped.remap(Bun::vm(globalObject));
        *outSourceURL = Bun::toStringRef(remapped[0].source_url.toWTFString());
        *outLine = OrdinalNumber::fromZeroBasedInt(remapped[0].position.line_zero_based).oneBasedInt();
        *outColumn = OrdinalNumber::fromZeroBasedInt(remapped[0].position.column_zero_based).oneBasedInt();
        return;
    }
}
