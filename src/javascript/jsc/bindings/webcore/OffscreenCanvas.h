#pragma once

#include "root.h"

#include "ContextDestructionObserver.h"
#include "EventTarget.h"
#include "ExceptionOr.h"
#include "IDLTypes.h"
// #include "ImageBuffer.h"
// #include "ImageBufferPipe.h"
// #include "IntSize.h"
#include "ScriptWrappable.h"
#include <wtf/FixedVector.h>
#include <wtf/Forward.h>
#include <wtf/RefCounted.h>
#include <wtf/ThreadSafeRefCounted.h>
#include <wtf/WeakPtr.h>
#include <wtf/text/WTFString.h>

namespace WebCore {
class OffscreenCanvasRenderingContext2D;
class OffscreenCanvas : public RefCounted<OffscreenCanvas>, public EventTargetWithInlineData, private ContextDestructionObserver {
    WTF_MAKE_ISO_ALLOCATED(OffscreenCanvas);

public:
    struct ImageEncodeOptions {
        String type = "image/png";
        double quality = 1.0;
    };

    enum class RenderingContextType {
        _2d,
        Webgl,
        Webgl2
    };
    using OffscreenRenderingContext = std::variant<
#if ENABLE(WEBGL)
        RefPtr<WebGLRenderingContext>,
#endif
#if ENABLE(WEBGL2)
        RefPtr<WebGL2RenderingContext>,
#endif
        RefPtr<OffscreenCanvasRenderingContext2D>>;

    inline unsigned width()
    {
        return m_width;
    }
    inline unsigned height()
    {
        return m_height;
    }
    void setWidth(unsigned dimension)
    {
        m_width = dimension;
    }
    void setHeight(unsigned dimension)
    {
        m_height = dimension;
    }

    ExceptionOr<std::optional<OffscreenRenderingContext>> getContext(JSC::JSGlobalObject&, RenderingContextType);

    using RefCounted::deref;
    using RefCounted::ref;

    static Ref<OffscreenCanvas> create(ScriptExecutionContext&, unsigned width, unsigned height);

    ~OffscreenCanvas();

private:
    OffscreenCanvas(ScriptExecutionContext& ctx, unsigned width, unsigned height);

    bool isOffscreenCanvas() const { return true; }

    ScriptExecutionContext* scriptExecutionContext() const { return ContextDestructionObserver::scriptExecutionContext(); }
    ScriptExecutionContext* canvasBaseScriptExecutionContext() const { return ContextDestructionObserver::scriptExecutionContext(); }

    EventTargetInterface eventTargetInterface() const { return OffscreenCanvasEventTargetInterfaceType; }
    void refEventTarget() { ref(); }
    void derefEventTarget() { deref(); }

    void refCanvasBase() { ref(); }
    void derefCanvasBase() { deref(); }

    // void setSize(const IntSize&) final;
    unsigned m_width;
    unsigned m_height;
};

}