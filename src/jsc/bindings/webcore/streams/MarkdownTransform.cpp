// `readable` and `writable` of a MarkdownStream (src/runtime/api/MarkdownStream.rs).
#include "config.h"

#include "ErrorCode.h"
#include "GeneratedMarkdownObject.h"
#include "JSDOMWrapperCache.h"
#include "JSReadableStream.h"
#include "JSTransformStream.h"
#include "JSTransformStreamDefaultController.h"
#include "JSWritableStream.h"
#include "RemovableFeatures.h"
#include "WebStreamsInternals.h"
#include "ZigGlobalObject.h"

namespace Bun {
namespace WebStreams {

using namespace JSC;
using Bindgen::Generated::JSMarkdownStream;

static JSMarkdownStream* markdownStreamOf(JSTransformStreamDefaultController* controller)
{
    return uncheckedDowncast<JSMarkdownStream>(controller->m_transformer.get());
}

template<typename Render>
static JSPromise* renderAndEnqueue(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, Render&& render)
{
    return promiseFromSteps(globalObject, [&] -> JSPromise* {
        auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
        JSValue rendered = render(markdownStreamOf(controller));
        RETURN_IF_EXCEPTION(scope, nullptr);
        if (rendered.isString() ? asString(rendered)->length() : asArray(rendered)->length()) {
            transformStreamDefaultControllerEnqueue(globalObject, controller, rendered);
            RETURN_IF_EXCEPTION(scope, nullptr);
        }
        RELEASE_AND_RETURN(scope, promiseFulfilledWith(globalObject, jsUndefined()));
    });
}

NEVER_INLINE JSPromise* markdownStreamTransform(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller, JSValue chunk)
{
    BUN_REMOVABLE_DEFINITION(Markdown, markdownStreamTransform);
    return renderAndEnqueue(globalObject, controller, [&](auto* markdown) { return markdown->write(globalObject, chunk); });
}

NEVER_INLINE JSPromise* markdownStreamFlush(JSGlobalObject* globalObject, JSTransformStreamDefaultController* controller)
{
    BUN_REMOVABLE_DEFINITION(Markdown, markdownStreamFlush);
    return renderAndEnqueue(globalObject, controller, [&](auto* markdown) { return markdown->end(globalObject, jsUndefined()); });
}

NEVER_INLINE void markdownStreamRelease(JSTransformStreamDefaultController* controller)
{
    BUN_REMOVABLE_DEFINITION(Markdown, markdownStreamRelease);
    auto* markdown = markdownStreamOf(controller);
    if (markdown->release()) {
        markdown->m_overrides.clear();
        markdown->m_kept.clear();
    }
}

// Errors both sides, and leaves the MarkdownStream open.
static void detachMarkdownTransform(JSGlobalObject* globalObject, JSTransformStream* transform)
{
    transform->m_controller->m_transformerKind = TransformerKind::Identity;
    transformStreamError(globalObject, transform, createError(globalObject, ErrorCode::ERR_INVALID_STATE, "A markdown stream cannot be piped after a call to write() or end()"_s));
}

static JSTransformStream* ensureMarkdownTransform(JSGlobalObject* globalObject, JSMarkdownStream* markdown, bool isCalledDirectly)
{
    if (auto* transform = markdown->m_transform.get())
        return transform;

    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* transform = JSTransformStream::create(vm, WebCore::getDOMStructure<JSTransformStream>(vm, *defaultGlobalObject(globalObject)));
    setUpNativeTransformStream(globalObject, transform, TransformerKind::Markdown);
    RETURN_IF_EXCEPTION(scope, nullptr);
    transform->m_controller->m_transformer.set(vm, transform->m_controller.get(), markdown);
    if (isCalledDirectly) {
        detachMarkdownTransform(globalObject, transform);
        RETURN_IF_EXCEPTION(scope, nullptr);
    }
    markdown->m_transform.set(vm, markdown, transform);
    return transform;
}

} // namespace WebStreams

using Bindgen::Generated::JSMarkdownStream;

JSC::JSValue JSMarkdownStream::readableSide(JSC::JSGlobalObject* globalObject, bool isCalledDirectly)
{
    auto* transform = WebStreams::ensureMarkdownTransform(globalObject, this, isCalledDirectly);
    return transform ? JSC::JSValue(transform->m_readable.get()) : JSC::JSValue();
}

JSC::JSValue JSMarkdownStream::writableSide(JSC::JSGlobalObject* globalObject, bool isCalledDirectly)
{
    auto* transform = WebStreams::ensureMarkdownTransform(globalObject, this, isCalledDirectly);
    return transform ? JSC::JSValue(transform->m_writable.get()) : JSC::JSValue();
}

JSC::JSValue JSMarkdownStream::detachUnlessPiping(JSC::JSGlobalObject* globalObject)
{
    auto* transform = m_transform.get();
    if (!transform)
        return JSC::jsBoolean(true);
    if (transform->m_nativeStateInUse)
        return JSC::jsBoolean(false);

    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    if (WebStreams::isReadableStreamLocked(transform->m_readable.get()) || WebStreams::isWritableStreamLocked(transform->m_writable.get())) {
        throwError(globalObject, scope, ErrorCode::ERR_INVALID_STATE, "write() and end() cannot be called while the markdown stream's readable or writable is locked"_s);
        return {};
    }
    WebStreams::detachMarkdownTransform(globalObject, transform);
    RETURN_IF_EXCEPTION(scope, {});
    return JSC::jsBoolean(true);
}

} // namespace Bun
