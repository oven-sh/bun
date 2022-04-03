#pragma once

#include "root.h"

#include "OffscreenCanvas.h"
#include "TextMetrics.h"
#include "CanvasRenderingContext2DSettings.h"
#include "CanvasDirection.h"
#include "CanvasPath.h"
#include "CanvasTextAlign.h"
#include "CanvasLineCap.h"
#include "CanvasLineJoin.h"
#include "CanvasGradient.h"
#include "CanvasPattern.h"
#include "CanvasTextBaseline.h"
#include "ImageSmoothingQuality.h"
#include "CanvasFillRule.h"
#include "ImageData.h"
#include "CanvasImageSource.h"

#include "include/core/SKPaint.h"
#include "include/core/SKColor.h"

namespace WebCore {

class OffscreenCanvasRenderingContext2D : public RefCounted<OffscreenCanvasRenderingContext2D>, public CanvasPath {
    WTF_MAKE_ISO_ALLOCATED(OffscreenCanvasRenderingContext2D);

public:
    static bool enabledForContext(ScriptExecutionContext&);

    OffscreenCanvasRenderingContext2D(OffscreenCanvas&, CanvasRenderingContext2DSettings&&);
    virtual ~OffscreenCanvasRenderingContext2D();

    OffscreenCanvas& canvas() const { return m_canvas; }

    void commit();

    void setFont(const String&);
    CanvasDirection direction() const;
    void fillText(const String& text, double x, double y, std::optional<double> maxWidth = std::nullopt);
    void strokeText(const String& text, double x, double y, std::optional<double> maxWidth = std::nullopt);
    Ref<TextMetrics> measureText(const String& text);

    double lineWidth() const { return state().lineWidth; }
    void setLineWidth(double);

    CanvasLineCap lineCap() const { return state().canvasLineCap(); }
    void setLineCap(CanvasLineCap);
    void setLineCap(const String&);

    CanvasLineJoin lineJoin() const { return state().canvasLineJoin(); }
    void setLineJoin(CanvasLineJoin);
    void setLineJoin(const String&);

    double miterLimit() const { return state().miterLimit; }
    void setMiterLimit(double);

    const Vector<double>& getLineDash() const { return state().lineDash; }
    void setLineDash(const Vector<double>&);

    const Vector<double>& webkitLineDash() const { return getLineDash(); }
    void setWebkitLineDash(const Vector<double>&);

    double lineDashOffset() const { return state().lineDashOffset; }
    void setLineDashOffset(double);

    float shadowOffsetX() const { return state().shadowOffset.width(); }
    void setShadowOffsetX(float);

    float shadowOffsetY() const { return state().shadowOffset.height(); }
    void setShadowOffsetY(float);

    float shadowBlur() const { return state().shadowBlur; }
    void setShadowBlur(float);

    String shadowColor() const { return state().shadowColorString(); }
    void setShadowColor(const String&);

    double globalAlpha() const { return state().globalAlpha; }
    void setGlobalAlpha(double);

    String globalCompositeOperation() const { return state().globalCompositeOperationString(); }
    void setGlobalCompositeOperation(const String&);

    void save() { ++m_unrealizedSaveCount; }
    void restore();

    void scale(double sx, double sy);
    void rotate(double angleInRadians);
    void translate(double tx, double ty);
    void transform(double m11, double m12, double m21, double m22, double dx, double dy);

    Ref<DOMMatrix> getTransform() const;
    void setTransform(double m11, double m12, double m21, double m22, double dx, double dy);
    ExceptionOr<void> setTransform(DOMMatrix2DInit&&);
    void resetTransform();

    void setStrokeColor(const String& color, std::optional<float> alpha = std::nullopt);
    void setStrokeColor(float grayLevel, float alpha = 1.0);
    void setStrokeColor(float r, float g, float b, float a);

    void setFillColor(const String& color, std::optional<float> alpha = std::nullopt);
    void setFillColor(float grayLevel, float alpha = 1.0f);
    void setFillColor(float r, float g, float b, float a);

    void beginPath();

    void fill(CanvasFillRule = CanvasFillRule::Nonzero);
    void stroke();
    void clip(CanvasFillRule = CanvasFillRule::Nonzero);

    void fill(Path2D&, CanvasFillRule = CanvasFillRule::Nonzero);
    void stroke(Path2D&);
    void clip(Path2D&, CanvasFillRule = CanvasFillRule::Nonzero);

    bool isPointInPath(double x, double y, CanvasFillRule = CanvasFillRule::Nonzero);
    bool isPointInStroke(double x, double y);

    bool isPointInPath(Path2D&, double x, double y, CanvasFillRule = CanvasFillRule::Nonzero);
    bool isPointInStroke(Path2D&, double x, double y);

    void clearRect(double x, double y, double width, double height);
    void fillRect(double x, double y, double width, double height);
    void strokeRect(double x, double y, double width, double height);

    void setShadow(float width, float height, float blur, const String& color = String(), std::optional<float> alpha = std::nullopt);
    void setShadow(float width, float height, float blur, float grayLevel, float alpha = 1.0);
    void setShadow(float width, float height, float blur, float r, float g, float b, float a);

    void clearShadow();

    ExceptionOr<void> drawImage(CanvasImageSource&&, float dx, float dy);
    ExceptionOr<void> drawImage(CanvasImageSource&&, float dx, float dy, float dw, float dh);
    ExceptionOr<void> drawImage(CanvasImageSource&&, float sx, float sy, float sw, float sh, float dx, float dy, float dw, float dh);

    void drawImageFromRect(HTMLImageElement&, float sx = 0, float sy = 0, float sw = 0, float sh = 0, float dx = 0, float dy = 0, float dw = 0, float dh = 0, const String& compositeOperation = emptyString());
    void clearCanvas();

    using StyleVariant = std::variant<String, RefPtr<CanvasGradient>, RefPtr<CanvasPattern>>;
    StyleVariant strokeStyle() const;
    void setStrokeStyle(StyleVariant&&);
    StyleVariant fillStyle() const;
    void setFillStyle(StyleVariant&&);

    ExceptionOr<Ref<CanvasGradient>> createLinearGradient(float x0, float y0, float x1, float y1);
    ExceptionOr<Ref<CanvasGradient>> createRadialGradient(float x0, float y0, float r0, float x1, float y1, float r1);
    ExceptionOr<Ref<CanvasGradient>> createConicGradient(float angleInRadians, float x, float y);
    ExceptionOr<RefPtr<CanvasPattern>> createPattern(CanvasImageSource&&, const String& repetition);

    ExceptionOr<Ref<ImageData>> createImageData(ImageData&) const;
    ExceptionOr<Ref<ImageData>> createImageData(int width, int height, std::optional<ImageDataSettings>) const;
    ExceptionOr<Ref<ImageData>> getImageData(int sx, int sy, int sw, int sh, std::optional<ImageDataSettings>) const;
    void putImageData(ImageData&, int dx, int dy);
    void putImageData(ImageData&, int dx, int dy, int dirtyX, int dirtyY, int dirtyWidth, int dirtyHeight);

    static constexpr float webkitBackingStorePixelRatio() { return 1; }

    void reset();

    bool imageSmoothingEnabled() const { return state().imageSmoothingEnabled; }
    void setImageSmoothingEnabled(bool);

    ImageSmoothingQuality imageSmoothingQuality() const { return state().imageSmoothingQuality; }
    void setImageSmoothingQuality(ImageSmoothingQuality);

    void setPath(Path2D&);
    Ref<Path2D> getPath() const;

    String font() const { return state().fontString(); }

    CanvasTextAlign textAlign() const { return state().canvasTextAlign(); }
    void setTextAlign(CanvasTextAlign);

    CanvasTextBaseline textBaseline() const { return state().canvasTextBaseline(); }
    void setTextBaseline(CanvasTextBaseline);

    using Direction = CanvasDirection;
    void setDirection(Direction);

private:
    using LineCap = SKPaint::Cap;
    using LineJoin = SKPaint::Join;
    using CanvasStyle = SKPaint::Style;
    using Color = SKColor;

    struct State final {
        State();

        String unparsedStrokeColor;
        String unparsedFillColor;
        CanvasStyle strokeStyle;
        CanvasStyle fillStyle;
        double lineWidth;
        LineCap lineCap;
        LineJoin lineJoin;
        double miterLimit;
        FloatSize shadowOffset;
        float shadowBlur;
        Color shadowColor;
        double globalAlpha;
        CompositeOperator globalComposite;
        SkBlendMode globalBlend;
        // AffineTransform transform;
        bool hasInvertibleTransform;
        Vector<double> lineDash;
        double lineDashOffset;
        bool imageSmoothingEnabled;
        ImageSmoothingQuality imageSmoothingQuality;
        TextAlign textAlign;
        TextBaseline textBaseline;
        Direction direction;

        String unparsedFont;
        FontProxy font;

        CanvasLineCap canvasLineCap() const;
        CanvasLineJoin canvasLineJoin() const;
        CanvasTextAlign canvasTextAlign() const;
        CanvasTextBaseline canvasTextBaseline() const;
        String fontString() const;
        String globalCompositeOperationString() const;
        String shadowColorString() const;
    };
    State state() const { return m_state; }
    bool isOffscreen2d() const { return true; }
    // const FontProxy* fontProxy() final;

    Ref<OffscreenCanvas> m_canvas;
    State m_state;
};

} // namespace WebCore

// SPECIALIZE_TYPE_TRAITS_CANVASRENDERINGCONTEXT(WebCore::OffscreenCanvasRenderingContext2D, isOffscreen2d())
