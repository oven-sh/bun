#include "root.h"

#include "AsyncContextFrame.h"
#include "BunClientData.h"
#include "ModuleGraph.h"
#include "NodeAsyncHooks.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/Exception.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/ObjectConstructor.h>

// bun test: which sequence code belongs to (a sequence is one test with its hooks), in a concurrent group that has
// tests or hooks of both "vitest" and "bun:test".
//
// The sequences of such a group run at once, and the runner's own state only says which test or hook started last.
// So for the time of the group the global object has a key (`m_testSequenceKey`), and the runner calls each test and
// hook of the group inside an async context frame that binds the key to the index of its sequence. What a callback
// starts (the rest of an async function, a timer) captures the frame. A reader looks the key up in the context its
// code runs in, or that an error comes from. The runner knows which test or hook that sequence runs.
// (Execution.rs: `step_sequence_one`. VirtualMachine.rs: `runs_vitest_entry`.)

using namespace JSC;

// Such a group starts. From here on the VM captures async contexts.
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__TestSequenceContext__begin(JSC::JSGlobalObject* lexicalGlobalObject)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    Bun::beginTrackingAsyncContexts(globalObject);
    globalObject->m_testSequenceKey.set(vm, globalObject, constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure()));
}

// The group is over. A frame that its code still holds binds a key that no reader looks up.
extern "C" [[ZIG_EXPORT(nothrow)]] void Bun__TestSequenceContext__end(JSC::JSGlobalObject* lexicalGlobalObject)
{
    defaultGlobalObject(lexicalGlobalObject)->m_testSequenceKey.clear();
}

// `callback` (as withAsyncContextIfNeeded() stored it) to call inside a frame that binds the key to `sequence`. The
// frame goes on top of the context the callback runs in without it: the one it was registered in, or the current one.
extern "C" [[ZIG_EXPORT(nothrow)]] JSC::EncodedJSValue Bun__TestSequenceContext__bind(JSC::JSGlobalObject* lexicalGlobalObject, int32_t sequence, JSC::EncodedJSValue encodedCallback)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    JSValue callback = JSValue::decode(encodedCallback);
    JSValue below;
    if (auto* wrapper = dynamicDowncast<AsyncContextFrame>(callback)) {
        callback = wrapper->callback.get();
        below = wrapper->context.get();
    } else {
        below = globalObject->m_asyncContextData.get()->getInternalField(0);
    }
    JSObject* frame = Bun::createAsyncContextFrame(globalObject, globalObject->m_testSequenceKey.get(), below, jsNumber(sequence));
    return JSValue::encode(AsyncContextFrame::create(vm, globalObject->AsyncContextFrameStructure(), callback, frame));
}

// Resolves `promise` with `thenable`, which `callback` returned. The job that calls then() runs in the async context
// that `callback` ran in.
extern "C" [[ZIG_EXPORT(check_slow)]] void Bun__TestSequenceContext__follow(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encodedCallback, JSC::EncodedJSValue encodedPromise, JSC::EncodedJSValue encodedThenable)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto* wrapper = dynamicDowncast<AsyncContextFrame>(JSValue::decode(encodedCallback));
    AsyncContextScope context(globalObject, wrapper ? wrapper->context.get() : JSValue());
    uncheckedDowncast<JSPromise>(JSValue::decode(encodedPromise))->resolve(globalObject, globalObject->vm(), JSValue::decode(encodedThenable));
}

// The sequence that the key is bound to where code runs or an error comes from, or -1 if no frame binds it. An
// Exception comes from the context it was thrown in (the engine notes it). Other code runs in the current one.
extern "C" [[ZIG_EXPORT(nothrow)]] int32_t Bun__TestSequenceContext__find(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue encodedThrown)
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    VM& vm = globalObject->vm();
    JSObject* key = globalObject->m_testSequenceKey.get();
    if (!key)
        return -1;
    JSValue asyncContext;
    JSValue thrown = JSValue::decode(encodedThrown);
    if (auto* exception = thrown && thrown.isCell() ? dynamicDowncast<JSC::Exception>(thrown.asCell()) : nullptr)
        asyncContext = exception->asyncContext();
    if (!asyncContext)
        asyncContext = globalObject->m_asyncContextData.get()->getInternalField(0);
    auto& names = WebCore::builtinNames(vm);
    for (JSObject* frame = asyncContext.getObject(); frame;) {
        if (frame->getDirect(vm, names.storagePublicName()) == key)
            return frame->getDirect(vm, vm.propertyNames->value).asInt32();
        JSValue previous = frame->getDirect(vm, names.prevPublicName());
        frame = previous ? previous.getObject() : nullptr;
    }
    return -1;
}
