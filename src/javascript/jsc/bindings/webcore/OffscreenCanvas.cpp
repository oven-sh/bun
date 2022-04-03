
#include "root.h"

#include "OffscreenCanvas.h"
#include "OffscreenCanvasRenderingContext2D.h"

namespace WebCore {

OffscreenCanvas::OffscreenCanvas(ScriptExecutionContext& scriptExecutionContext, unsigned width, unsigned height)
    : ContextDestructionObserver(&scriptExecutionContext)
{
    m_width = width;
    m_height = height;
}

Ref<OffscreenCanvas> OffscreenCanvas::create(ScriptExecutionContext& scriptExecutionContext, unsigned width, unsigned height)
{
    return adoptRef(*new OffscreenCanvas(scriptExecutionContext, width, height));
}

ExceptionOr<std::optional<OffscreenCanvas::OffscreenRenderingContext>> getContext(JSC::JSGlobalObject&, OffscreenCanvas::RenderingContextType)
{
    return Exception { TypeError, "Not implemented yet"_s };
}

}