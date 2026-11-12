#include "config.h"

#include "AsyncContextFrame.h"
#include "ModuleGraph.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/InternalFieldTuple.h>

namespace Bun {

using namespace JSC;

static void setAsyncContextFromEventLoop(JSGlobalObject* globalObject, JSValue asyncContext)
{
    globalObject->m_asyncContextData.get()->putInternalField(globalObject->vm(), 0, asyncContext);
    if (auto* zigGlobalObject = dynamicDowncast<Zig::GlobalObject>(globalObject))
        noteEnteredFromEventLoop(zigGlobalObject, asyncContext);
}

// FileReader::call_read_callback (FileReader.rs): Bun__JSValue__call leaves the async context of a stored callback before it returns, and what the callback threw is reported after that. Entered around both, the report is made inside that context, as Bun__JSTimeout__call makes a timer's. Returns the async context to put back, or the empty value when `callback` carries none.
extern "C" EncodedJSValue Bun__enterAsyncContextOfCallback(JSGlobalObject* globalObject, EncodedJSValue callback)
{
    auto* frame = dynamicDowncast<AsyncContextFrame>(JSValue::decode(callback));
    if (!frame)
        return JSValue::encode(JSValue());
    JSValue previous = globalObject->m_asyncContextData.get()->getInternalField(0);
    setAsyncContextFromEventLoop(globalObject, frame->context.get());
    return JSValue::encode(previous ? previous : jsUndefined());
}

extern "C" void Bun__leaveAsyncContextOfCallback(JSGlobalObject* globalObject, EncodedJSValue previous)
{
    setAsyncContextFromEventLoop(globalObject, JSValue::decode(previous));
}

} // namespace Bun
