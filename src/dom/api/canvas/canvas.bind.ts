import * as b from "../../../codegen/bindgen-lib.ts";
import { DesktopEventTarget, DomElement } from "../core/core.bind.ts";
import { HTMLElement } from "../core/html.bind.ts";
import { htmlConstructor, reflect } from "../core/reflect.ts";
import { OnEvent, WindowTarget } from "../events/events.bind.ts";
import { DOMMatrix2DInit, DOMPointInit } from "../geometry/geometry.bind.ts";

export default b.module({
  rustPath: "crate::api::canvas",
  ceReactions: "crate::api::core::custom",
  feature: "Desktop",
  membersInTable: false,
  isCold: true,
});

const heap = { capability: "heap" } as const;
const fallible = { capability: "heap", throws: true } as const;
const js = { capability: "js", throws: true } as const;
const webidl = { webidl: true } as const;
const number = b.f64.loose;
const text = b.DOMString.utf8;
const long = b.i32.enforceRange();
const each = <T>(names: string, type: T) => Object.fromEntries(names.split(" ").map(name => [name, type]));
const numbers = (names: string) => each(names, number);
const plain = <T>(getter: T) => ({ getter, setter: true, pure: true }) as const;
const choice = <T>(getter: T) => ({ getter, setter: true, ignoreInvalid: true }) as const;
const path = b.ref("Path2D");
const imageData = b.ref("ImageData");
const imageSources = {
  image: b.ref("HTMLImageElement"),
  svgImage: b.ref("SVGImageElement"),
  video: b.ref("HTMLVideoElement"),
  canvas: b.ref("HTMLCanvasElement"),
  bitmap: b.ref("ImageBitmap"),
  offscreen: b.ref("OffscreenCanvas"),
};
export const CanvasImageSource = b.union(imageSources, webidl);
export const ImageBitmapSource = b.union(
  {
    ...imageSources,
    blob: b.instanceOf("Blob", "Bun::Bindgen::Generated::JSBlob", "GeneratedBlob.h"),
    data: imageData,
  },
  webidl,
);

export const PredefinedColorSpace = b.enumeration(["srgb", "display-p3"]);
export const CanvasColorType = b.enumeration(["unorm8", "float16"]);
export const CanvasFillRule = b.enumeration(["nonzero", "evenodd"]);
export const ImageSmoothingQuality = b.enumeration(["low", "medium", "high"]);
export const CanvasLineCap = b.enumeration(["butt", "round", "square"]);
export const CanvasLineJoin = b.enumeration(["round", "bevel", "miter"]);
export const CanvasTextAlign = b.enumeration(["start", "end", "left", "right", "center"]);
export const CanvasTextBaseline = b.enumeration(["top", "hanging", "middle", "alphabetic", "ideographic", "bottom"]);
export const CanvasDirection = b.enumeration(["ltr", "rtl", "inherit"]);
export const CanvasFontKerning = b.enumeration(["auto", "normal", "none"]);
export const CanvasFontStretch = b.enumeration([
  "ultra-condensed",
  "extra-condensed",
  "condensed",
  "semi-condensed",
  "normal",
  "semi-expanded",
  "expanded",
  "extra-expanded",
  "ultra-expanded",
]);
export const CanvasFontVariantCaps = b.enumeration([
  "normal",
  "small-caps",
  "all-small-caps",
  "petite-caps",
  "all-petite-caps",
  "unicase",
  "titling-caps",
]);
export const CanvasTextRendering = b.enumeration(["auto", "optimizeSpeed", "optimizeLegibility", "geometricPrecision"]);
/** A `DOMString` in the IDL, which is ignored unless it is one of these. */
export const GlobalCompositeOperation = b.enumeration([
  "source-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "lighter",
  "copy",
  "xor",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  "clear",
]);
export const ImageDataPixelFormat = b.enumeration(["rgba-unorm8", "rgba-float16"]);
export const ImageOrientation = b.enumeration(["from-image", "flipY", "none"]);
export const PremultiplyAlpha = b.enumeration(["none", "premultiply", "default"]);
export const ColorSpaceConversion = b.enumeration(["none", "default"]);
export const ResizeQuality = b.enumeration(["pixelated", "low", "medium", "high"]);

export const CanvasRenderingContext2DSettings = b.dictionary(
  {
    alpha: b.bool.loose.default(true),
    colorSpace: PredefinedColorSpace.default("srgb"),
    colorType: CanvasColorType.default("unorm8"),
    desynchronized: b.bool.loose.default(false),
    willReadFrequently: b.bool.loose.default(false),
  },
  { ...webidl, nonObjectAsEmpty: true },
);
export const ContextAttributes = b.dictionary({
  alpha: b.bool,
  colorSpace: PredefinedColorSpace,
  colorType: CanvasColorType,
  desynchronized: b.bool,
  willReadFrequently: b.bool,
});
export const ImageDataSettings = b.dictionary(
  { colorSpace: PredefinedColorSpace.optional, pixelFormat: ImageDataPixelFormat.default("rgba-unorm8") },
  { ...webidl, fromJS: true },
);
export const ImageBitmapOptions = b.dictionary(
  {
    colorSpaceConversion: ColorSpaceConversion.default("default"),
    imageOrientation: ImageOrientation.default("from-image"),
    premultiplyAlpha: PremultiplyAlpha.default("default"),
    resizeHeight: b.u32.enforceRange().optional,
    resizeQuality: ResizeQuality.default("low"),
    resizeWidth: b.u32.enforceRange().optional,
  },
  webidl,
);

export const Radius = b.union({ point: DOMPointInit, number }, webidl);
export const Radii = b.union({ list: b.sequenceVec(Radius), point: DOMPointInit, number }, webidl);
export const Path2DOrString = b.union({ path, data: text }, webidl);
export const CanvasStyle = b.union(
  { gradient: b.ref("CanvasGradient"), pattern: b.ref("CanvasPattern"), color: text },
  webidl,
);
export const ImageDataArray = b.union(
  { bytes: b.typedArray("Uint8ClampedArray"), halves: b.typedArray("Float16Array") },
  webidl,
);

export const HasPath = b.interface("HasPath", { abstract: true, rustPath: "crate::api::canvas::Path", size: 104 });

export const CanvasPath = b.mixin("CanvasPath", {
  on: HasPath,
  proto: {
    closePath: {},
    moveTo: { args: numbers("x y"), isCold: false },
    lineTo: { args: numbers("x y"), isCold: false },
    quadraticCurveTo: { args: numbers("cpx cpy x y") },
    bezierCurveTo: { args: numbers("cp1x cp1y cp2x cp2y x y"), isCold: false },
    arcTo: { args: numbers("x1 y1 x2 y2 radius"), throws: true },
    rect: { args: numbers("x y w h"), isCold: false },
    roundRect: { args: { ...numbers("x y w h"), radii: Radii.optional }, throws: true },
    arc: {
      args: { ...numbers("x y radius startAngle endAngle"), counterclockwise: b.bool.loose.default(false) },
      throws: true,
    },
    ellipse: {
      args: {
        ...numbers("x y radiusX radiusY rotation startAngle endAngle"),
        counterclockwise: b.bool.loose.default(false),
      },
      throws: true,
    },
  },
});

export const Path2D = b.interface("Path2D", {
  extends: HasPath,
  includes: [CanvasPath],
  construct: { args: { path: Path2DOrString.optional } },
  proto: { addPath: { args: { path, transform: DOMMatrix2DInit.default({}) }, throws: true } },
});

export const CanvasGradient = b.interface("CanvasGradient", {
  rustPath: "crate::api::canvas::CanvasGradient",
  proto: { addColorStop: { args: { offset: b.double, color: text }, throws: true } },
});

export const CanvasPattern = b.interface("CanvasPattern", {
  rustPath: "crate::api::canvas::CanvasPattern",
  estimatedSize: true,
  proto: { setTransform: { args: { transform: DOMMatrix2DInit.default({}) }, throws: true } },
});

export const TextMetrics = b.interface("TextMetrics", {
  rustPath: "crate::api::canvas::TextMetrics",
  proto: each(
    "width actualBoundingBoxLeft actualBoundingBoxRight fontBoundingBoxAscent fontBoundingBoxDescent actualBoundingBoxAscent actualBoundingBoxDescent emHeightAscent emHeightDescent hangingBaseline alphabeticBaseline ideographicBaseline",
    { getter: b.f64, pure: true },
  ),
});

const settings = ImageDataSettings.default({});

export const ImageData = b.interface("ImageData", {
  rustPath: "crate::api::canvas::ImageData",
  internalFields: ["data"],
  serializable: true,
  construct: [
    {
      rustName: "construct_from_data",
      args: { data: ImageDataArray, sw: b.u32.wrap, sh: b.u32.wrap.optional, settings },
      passStructure: true,
      ...fallible,
    },
    {
      rustName: "construct_blank",
      args: { sw: b.u32.wrap, sh: b.u32.wrap, settings },
      passStructure: true,
      ...fallible,
    },
  ],
  proto: {
    width: { getter: b.u32, pure: true },
    height: { getter: b.u32, pure: true },
    data: { getter: b.object, field: "data", onlyReads: true },
    pixelFormat: { getter: ImageDataPixelFormat },
    colorSpace: { getter: PredefinedColorSpace },
  },
});

export const ImageBitmap = b.interface("ImageBitmap", {
  rustPath: "crate::api::canvas::ImageBitmap",
  serializable: true,
  estimatedSize: true,
  proto: { width: { getter: b.u32, pure: true }, height: { getter: b.u32, pure: true }, close: {} },
});

export const ImageBitmapRenderingContext = b.interface("ImageBitmapRenderingContext", {
  internalFields: { canvas: b.any, context: b.ref("Canvas2D") },
  proto: {
    canvas: { getter: b.object, field: "canvas" },
    transferFromImageBitmap: { args: { bitmap: b.ref("ImageBitmap").nullable }, ...fallible },
  },
});

export const Canvas2D = b.interface("Canvas2D", {
  abstract: true,
  extends: HasPath,
  rustPath: "crate::api::canvas::Context",
  internalFields: {
    ...each("canvas fillStyle strokeStyle savedStyles", b.any),
    renderer: b.ref("ImageBitmapRenderingContext"),
  },
  estimatedSize: true,
});

const fillRule = CanvasFillRule.default("nonzero");
const gradient = b.ref("CanvasGradient");
const style = {
  getter: b.any.returning("string", "CanvasGradient", "CanvasPattern"),
  setter: { type: CanvasStyle, ...js },
  isCold: false,
  ...fallible,
} as const;
const drawnText = { text, ...numbers("x y"), maxWidth: number.optional };

/** The mixins that both 2D contexts include, but for `CanvasPath`. */
export const CanvasDrawing = b.mixin("CanvasDrawing", {
  on: Canvas2D,
  proto: {
    canvas: { getter: b.object, field: "canvas" },
    getContextAttributes: { returns: ContextAttributes },
    save: fallible,
    restore: fallible,
    reset: {},
    isContextLost: { returns: b.bool },
    scale: { args: numbers("x y") },
    rotate: { args: numbers("angle") },
    translate: { args: numbers("x y"), isCold: false },
    transform: { args: numbers("a b c d e f") },
    getTransform: { returns: b.any.returning("object"), ...js },
    setTransform: [
      { args: numbers("a b c d e f") },
      { rustName: "set_transform_to", args: { transform: DOMMatrix2DInit.default({}) }, throws: true },
    ],
    resetTransform: {},
    globalAlpha: plain(number),
    globalCompositeOperation: choice(GlobalCompositeOperation),
    imageSmoothingEnabled: plain(b.bool.loose),
    imageSmoothingQuality: choice(ImageSmoothingQuality),
    strokeStyle: style,
    fillStyle: style,
    createLinearGradient: { args: each("x0 y0 x1 y1", b.double), returns: gradient, ...heap },
    createRadialGradient: { args: each("x0 y0 r0 x1 y1 r1", b.double), returns: gradient, ...fallible },
    createConicGradient: { args: each("startAngle x y", b.double), returns: gradient, ...heap },
    createPattern: {
      args: { image: CanvasImageSource, repetition: b.DOMString.nullToEmpty.utf8 },
      returns: b.ref("CanvasPattern").nullable,
      ...js,
    },
    shadowOffsetX: plain(number),
    shadowOffsetY: plain(number),
    shadowBlur: plain(number),
    shadowColor: { getter: text, setter: js },
    filter: { getter: text, setter: js },
    clearRect: { args: numbers("x y w h"), isCold: false },
    fillRect: { args: numbers("x y w h"), isCold: false },
    strokeRect: { args: numbers("x y w h") },
    beginPath: {},
    fill: [{ rustName: "fill_given", args: { path, fillRule } }, { args: { fillRule } }],
    stroke: [{}, { rustName: "stroke_given", args: { path } }],
    clip: [{ rustName: "clip_given", args: { path, fillRule } }, { args: { fillRule } }],
    isPointInPath: [
      { rustName: "is_point_in_given_path", args: { path, ...numbers("x y"), fillRule }, returns: b.bool },
      { args: { ...numbers("x y"), fillRule }, returns: b.bool },
    ],
    isPointInStroke: [
      { args: numbers("x y"), returns: b.bool },
      { rustName: "is_point_in_given_stroke", args: { path, ...numbers("x y") }, returns: b.bool },
    ],
    fillText: { args: drawnText, ...js },
    strokeText: { args: drawnText, ...js },
    measureText: { args: { text }, returns: b.ref("TextMetrics"), ...js },
    drawImage: [
      { args: { image: CanvasImageSource, ...numbers("dx dy") }, ...js },
      { rustName: "draw_image_sized", args: { image: CanvasImageSource, ...numbers("dx dy dw dh") }, ...js },
      { rustName: "draw_image_part", args: { image: CanvasImageSource, ...numbers("sx sy sw sh dx dy dw dh") }, ...js },
    ],
    createImageData: [
      { args: { ...each("sw sh", long), settings }, returns: imageData, ...fallible },
      { rustName: "create_image_data_like", args: { imageData }, returns: imageData, ...fallible },
    ],
    getImageData: { args: { ...each("sx sy sw sh", long), settings }, returns: imageData, ...fallible },
    putImageData: [
      { args: { imageData, ...each("dx dy", long) }, ...fallible },
      {
        rustName: "put_image_data_part",
        args: { imageData, ...each("dx dy dirtyX dirtyY dirtyWidth dirtyHeight", long) },
        ...fallible,
      },
    ],
    lineWidth: plain(number),
    lineCap: choice(CanvasLineCap),
    lineJoin: choice(CanvasLineJoin),
    miterLimit: plain(number),
    setLineDash: { args: { segments: b.sequenceVec(number) } },
    getLineDash: { returns: b.array(b.f64) },
    lineDashOffset: plain(number),
    lang: { getter: text, setter: true },
    font: { getter: text, setter: js },
    textAlign: choice(CanvasTextAlign),
    textBaseline: choice(CanvasTextBaseline),
    direction: choice(CanvasDirection),
    letterSpacing: { getter: text, setter: true },
    fontKerning: choice(CanvasFontKerning),
    fontStretch: choice(CanvasFontStretch),
    fontVariantCaps: choice(CanvasFontVariantCaps),
    textRendering: choice(CanvasTextRendering),
    wordSpacing: { getter: text, setter: true },
  },
});

export const CanvasRenderingContext2D = b.interface("CanvasRenderingContext2D", {
  extends: Canvas2D,
  includes: [CanvasDrawing, CanvasPath],
  proto: {
    drawFocusIfNeeded: [
      { args: { element: DomElement }, ...js },
      { rustName: "draw_given_focus_if_needed", args: { path, element: DomElement }, ...js },
    ],
  },
});

export const OffscreenCanvasRenderingContext2D = b.interface("OffscreenCanvasRenderingContext2D", {
  extends: Canvas2D,
  includes: [CanvasDrawing, CanvasPath],
});

const options = ImageBitmapOptions.default({});
const promise = { returns: b.any.returning("Promise"), rejects: true, ...js } as const;

export const ImageBitmapFactories = b.mixin("ImageBitmapFactories", {
  on: WindowTarget,
  proto: {
    createImageBitmap: [
      { rustName: "create_image_bitmap", args: { image: ImageBitmapSource, options }, ...promise },
      {
        rustName: "create_image_bitmap_of_part",
        args: { image: ImageBitmapSource, ...each("sx sy sw sh", b.i32.wrap), options },
        ...promise,
      },
    ],
  },
});

const contextOptions = CanvasRenderingContext2DSettings.default({});
const encoding = { type: text.default("image/png"), quality: b.any.omittable };

export const HTMLCanvasElement = b.interface("HTMLCanvasElement", {
  extends: HTMLElement,
  ...htmlConstructor,
  proto: {
    ...reflect("width+300 height+150"),
    getContext: { args: { contextId: text, options: contextOptions }, returns: b.any, ...js },
    toDataURL: { rustName: "to_data_url", args: encoding, returns: b.USVString.utf8, ...js },
    toBlob: { args: { callback: b.callable, ...encoding }, ...js },
    transferControlToOffscreen: { returns: b.ref("OffscreenCanvas"), ...js },
  },
});

export const OffscreenRenderingContextId = b.enumeration({
  TwoD: "2d",
  Bitmaprenderer: "bitmaprenderer",
  Webgl: "webgl",
  Webgl2: "webgl2",
  Webgpu: "webgpu",
});
export const ImageEncodeOptions = b.dictionary({ quality: number.optional, type: text.default("image/png") }, webidl);
const side = b.u64.enforceRange();

export const OffscreenCanvas = b.interface("OffscreenCanvas", {
  extends: DesktopEventTarget,
  rustPath: "crate::api::canvas::OffscreenCanvas",
  internalFields: { context: Canvas2D, placeholder: HTMLCanvasElement },
  construct: { args: { width: side, height: side } },
  proto: {
    ...each("width height", { getter: b.f64, setter: { type: side, ...js } }),
    getContext: {
      args: { contextId: OffscreenRenderingContextId, options: contextOptions },
      returns: b.any,
      ...fallible,
    },
    transferToImageBitmap: { returns: ImageBitmap, ...fallible },
    convertToBlob: { args: { options: ImageEncodeOptions.default({}) }, ...promise },
    oncontextlost: OnEvent.of('crate::api::core::atom!("contextlost")'),
    oncontextrestored: OnEvent.of('crate::api::core::atom!("contextrestored")'),
  },
});
