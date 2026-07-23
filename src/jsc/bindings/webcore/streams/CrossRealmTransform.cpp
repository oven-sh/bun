#include "config.h"
#include "WebStreamsInternals.h"

#include "JSStreamsRuntime.h"
#include <JavaScriptCore/JSCInlines.h>

// Transferable streams are out of scope: Bun's structured clone never transfers a stream, so
// no caller can reach these today. Each entry point fails loudly (a thrown TypeError) so an
// accidental future caller cannot half-set-up a cross-realm transform.

namespace Bun {
namespace WebStreams {

using namespace JSC;

void crossRealmTransformSendError(JSGlobalObject* globalObject, WebCore::MessagePort&, JSValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "ReadableStream transfer is not implemented"_s);
}

void packAndPostMessage(JSGlobalObject* globalObject, WebCore::MessagePort&, CrossRealmMessageType, JSValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "ReadableStream transfer is not implemented"_s);
}

bool packAndPostMessageHandlingError(JSGlobalObject* globalObject, WebCore::MessagePort&, CrossRealmMessageType, JSValue)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "ReadableStream transfer is not implemented"_s);
    return false;
}

void setUpCrossRealmTransformReadable(JSGlobalObject* globalObject, JSReadableStream*, WebCore::MessagePort&)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "ReadableStream transfer is not implemented"_s);
}

void setUpCrossRealmTransformWritable(JSGlobalObject* globalObject, JSWritableStream*, WebCore::MessagePort&)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    throwTypeError(globalObject, scope, "WritableStream transfer is not implemented"_s);
}

} // namespace WebStreams
} // namespace Bun

namespace WebCore {

// Registered only by setUpCrossRealmTransformWritable, which never sets a transform up.
JSC_DEFINE_HOST_FUNCTION(jsWebStreamsHandler_onCrossRealmWritableBackpressureFulfilled, (JSC::JSGlobalObject*, JSC::CallFrame*))
{
    RELEASE_ASSERT_NOT_REACHED();
    return {};
}

} // namespace WebCore
