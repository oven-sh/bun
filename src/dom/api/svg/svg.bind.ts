import * as b from "../../../codegen/bindgen-lib.ts";
import { DomElement as Element } from "../core/core.bind.ts";
import { HTMLOrSVGElement } from "../core/html.bind.ts";
import { reflect as asInHtml, tokenList } from "../core/reflect.ts";
import { DOMMatrix2DInit, DOMPointInit } from "../geometry/geometry.bind.ts";

export default b.module({
  rustPath: "crate::api::svg",
  ceReactions: "crate::api::core::custom",
  isCold: true,
  feature: "Desktop",
  membersInTable: false,
});

const heap = { capability: "heap" } as const;
const fallible = { capability: "heap", throws: true } as const;
const runs = { capability: "js" } as const;
const js = { capability: "js", throws: true } as const;
const words = (text: string) => text.split(/\s+/).filter(Boolean);
const each = <T>(names: string, make: (name: string, index: number) => T) =>
  Object.fromEntries(words(names).map((name, index) => [name, make(name, index)]));
const floats = (names: string) => each(names, () => b.float);
const constants = (prefix: string, names: string) =>
  Object.fromEntries(["UNKNOWN", ...words(names)].map((name, index) => [prefix + name, index]));
const settable = <T>(getter: T) => ({ getter, setter: js, ...runs }) as const;
const short = b.u16.wrap;
const index = b.u32.wrap;
const matrix = DOMMatrix2DInit.default({});
const point = DOMPointInit.default({});

// ───────────────────────────── values ─────────────────────────────

export const SvgValue = b.interface("SvgValue", {
  abstract: true,
  rustPath: "crate::api::svg::Value",
  internalFields: { owner: b.any, matrix: b.ref("SVGMatrix") },
});
const field = "crate::api::svg::Field";
export const SvgFloat = b.family("SvgFloat", { on: SvgValue, key: field, ...settable(b.float) });
export const SvgDouble = b.family("SvgDouble", { on: SvgValue, key: field, ...settable(b.double) });
const fields = (names: string, family = SvgFloat) => each(names, (_, at) => family.of(`${field}(${at})`));

export const SVGNumber = b.interface("SVGNumber", { extends: SvgValue, proto: fields("value") });
export const SVGRect = b.interface("SVGRect", { extends: SvgValue, proto: fields("x y width height") });
export const SVGPoint = b.interface("SVGPoint", {
  extends: SvgValue,
  proto: { ...fields("x y"), matrixTransform: { args: { matrix }, returns: b.ref("SVGPoint"), ...js } },
});

const product = { returns: b.ref("SVGMatrix"), ...runs } as const;
export const SVGMatrix = b.interface("SVGMatrix", {
  extends: SvgValue,
  proto: {
    ...fields("a b c d e f", SvgDouble),
    multiply: { args: { secondMatrix: matrix }, ...product, throws: true },
    inverse: { ...product, throws: true },
    translate: { args: floats("x y"), ...product },
    scale: { args: floats("scaleFactor"), ...product },
    scaleNonUniform: { args: floats("scaleFactorX scaleFactorY"), ...product },
    rotate: { args: floats("angle"), ...product },
    rotateFromVector: { args: floats("x y"), ...product, throws: true },
    flipX: product,
    flipY: product,
    skewX: { args: floats("angle"), ...product },
    skewY: { args: floats("angle"), ...product },
  },
});

const dimension = {
  valueInSpecifiedUnits: settable(b.float),
  valueAsString: settable(b.DOMString.utf8),
  newValueSpecifiedUnits: { args: { unitType: short, valueInSpecifiedUnits: b.float }, ...js },
  convertToSpecifiedUnits: { args: { unitType: short }, ...js },
} as const;

export const SVGLength = b.interface("SVGLength", {
  extends: SvgValue,
  constants: constants("SVG_LENGTHTYPE_", "NUMBER PERCENTAGE EMS EXS PX CM MM IN PT PC"),
  proto: { unitType: { getter: b.u16, ...runs }, value: { getter: b.float, setter: true, ...js }, ...dimension },
});

export const SVGAngle = b.interface("SVGAngle", {
  extends: SvgValue,
  constants: constants("SVG_ANGLETYPE_", "UNSPECIFIED DEG RAD GRAD"),
  proto: { unitType: { getter: b.u16, ...runs }, value: settable(b.float), ...dimension },
});

export const SVGTransform = b.interface("SVGTransform", {
  extends: SvgValue,
  constants: constants("SVG_TRANSFORM_", "MATRIX TRANSLATE SCALE ROTATE SKEWX SKEWY"),
  proto: {
    type: { getter: b.u16, ...runs },
    matrix: { getter: SVGMatrix, cache: "matrix", ...heap },
    angle: { getter: b.float, ...runs },
    setMatrix: { args: { matrix }, ...js },
    setTranslate: { args: floats("tx ty"), ...js },
    setScale: { args: floats("sx sy"), ...js },
    setRotate: { args: floats("angle x y"), ...js },
    setSkewX: { args: floats("angle"), ...js },
    setSkewY: { args: floats("angle"), ...js },
  },
});

export const SVGPreserveAspectRatio = b.interface("SVGPreserveAspectRatio", {
  extends: SvgValue,
  constants: {
    ...constants(
      "SVG_PRESERVEASPECTRATIO_",
      "NONE XMINYMIN XMIDYMIN XMAXYMIN XMINYMID XMIDYMID XMAXYMID XMINYMAX XMIDYMAX XMAXYMAX",
    ),
    ...constants("SVG_MEETORSLICE_", "MEET SLICE"),
  },
  proto: { align: settable(short), meetOrSlice: settable(short) },
});

export const SVGUnitTypes = b.interface("SVGUnitTypes", {
  constants: constants("SVG_UNIT_TYPE_", "USERSPACEONUSE OBJECTBOUNDINGBOX"),
});

// ───────────────────────────── lists ─────────────────────────────

export const SvgList = b.interface("SvgList", {
  abstract: true,
  rustPath: "crate::api::svg::ValueList",
  internalFields: { element: b.ref("DomElement"), items: b.any },
  indexed: { getter: b.any, setter: true, length: "indexed_length", ...js },
});

const newItem = b.any;
const item = { returns: b.any, ...js } as const;
const length = { getter: b.u32, rustName: "length", ...runs } as const;
export const SvgListMembers = b.mixin("SvgListMembers", {
  on: SvgList,
  proto: {
    length,
    numberOfItems: length,
    clear: js,
    initialize: { args: { newItem }, ...item },
    getItem: { args: { index }, ...item },
    insertItemBefore: { args: { newItem, index }, ...item },
    replaceItem: { args: { newItem, index }, ...item },
    removeItem: { args: { index }, ...item },
    appendItem: { args: { newItem }, ...item },
  },
});

const list = { extends: SvgList, includes: [SvgListMembers] } as const;
export const SVGNumberList = b.interface("SVGNumberList", list);
export const SVGLengthList = b.interface("SVGLengthList", list);
export const SVGStringList = b.interface("SVGStringList", list);
export const SVGPointList = b.interface("SVGPointList", list);
const fromMatrix = {
  rustName: "create_svg_transform_from_matrix",
  args: { matrix },
  returns: SVGTransform,
  ...fallible,
};
export const SVGTransformList = b.interface("SVGTransformList", {
  ...list,
  proto: { createSVGTransformFromMatrix: fromMatrix, consolidate: item },
});

// ───────────────────────────── attributes ─────────────────────────────

export const SvgAnimated = b.interface("SvgAnimated", {
  abstract: true,
  rustPath: "crate::api::svg::Animated",
  internalFields: ["element", "baseVal", "animVal"],
});

const primitive = <T>(getter: T, setter: object = runs) => ({
  extends: SvgAnimated,
  proto: { baseVal: { getter, setter, ...runs }, animVal: { getter, ...runs } },
});
export const SVGAnimatedBoolean = b.interface("SVGAnimatedBoolean", primitive(b.bool.loose));
export const SVGAnimatedEnumeration = b.interface("SVGAnimatedEnumeration", primitive(short, js));
export const SVGAnimatedInteger = b.interface("SVGAnimatedInteger", primitive(b.i32.wrap));
export const SVGAnimatedNumber = b.interface("SVGAnimatedNumber", primitive(b.float));
export const SVGAnimatedString = b.interface("SVGAnimatedString", primitive(b.DOMString, { type: b.any, ...js }));

export const SvgAnimatedObject = b.mixin("SvgAnimatedObject", {
  on: SvgAnimated,
  proto: each("baseVal animVal", field => ({ getter: b.object, field })),
});
const object = { extends: SvgAnimated, includes: [SvgAnimatedObject] };
export const SVGAnimatedLength = b.interface("SVGAnimatedLength", object);
export const SVGAnimatedAngle = b.interface("SVGAnimatedAngle", object);
export const SVGAnimatedRect = b.interface("SVGAnimatedRect", object);
export const SVGAnimatedPreserveAspectRatio = b.interface("SVGAnimatedPreserveAspectRatio", object);
export const SVGAnimatedNumberList = b.interface("SVGAnimatedNumberList", object);
export const SVGAnimatedLengthList = b.interface("SVGAnimatedLengthList", object);
export const SVGAnimatedTransformList = b.interface("SVGAnimatedTransformList", object);

export const SvgReflection = b.family("SvgReflection", {
  on: Element,
  key: "crate::api::svg::syntax::Reflected",
  getter: b.any.returning("object"),
  ...heap,
});

const path = "crate::api::svg::syntax";
const reflect = (attribute: string, syntax: string, how = "new") =>
  SvgReflection.of(`${path}::Reflected::${how}(crate::api::core::atom!("${attribute}"), ${path}::Syntax::${syntax})`);
const float = (value: number) => value.toFixed(1);
const axisOf = (name: string) =>
  `${path}::Axis::${/^([cfdr]?x\d?|refX|width|markerWidth)$/.test(name) ? "X" : /^([cfdr]?y\d?|refY|height|markerHeight)$/.test(name) ? "Y" : "Other"}`;
const lengths = (names: string, initial = 0, unit = "Number") =>
  each(names, name => reflect(name, `Length(${axisOf(name)}, ${float(initial)}, crate::calc::Unit::${unit})`));
const percentages = (names: string, initial: number) => lengths(names, initial, "Percent");
const numbers = (names: string, initial = 0) => each(names, name => reflect(name, `Number(${float(initial)})`));
const integers = (names: string, initial = 0) => each(names, name => reflect(name, `Integer(${initial})`));
const strings = (names: string) => each(names, name => reflect(name, "Text"));
const pair = (name: string, syntax: string) => ({
  [name + "X"]: reflect(name, syntax),
  [name + "Y"]: reflect(name, syntax, "second"),
});
const numberPair = (name: string, initial = 0) => pair(name, `NumberPair(${float(initial)})`);
const keyword = (name: string, keywords: string, initial = 1) => ({
  [name]: reflect(name, `Keyword(&${JSON.stringify(words(keywords))}, ${initial})`),
});
const units = (name: string, initial: number) => keyword(name, "userSpaceOnUse objectBoundingBox", initial);

const href = strings("href");
const in1 = { in1: reflect("in", "Text") };
const box = lengths("x y width height");
const region = { ...percentages("x y", -10), ...percentages("width height", 120) };
const preserveAspectRatio = reflect("preserveAspectRatio", "Ratio");
const fitted = { viewBox: reflect("viewBox", "ViewBox"), preserveAspectRatio };
const tests = {
  requiredExtensions: reflect("requiredExtensions", "Tokens"),
  systemLanguage: reflect("systemLanguage", "Languages"),
};

// ───────────────────────────── elements ─────────────────────────────

const ancestor = { getter: b.ref("DomElement").nullable } as const;

export const SVGElement = b.interface("SVGElement", {
  extends: Element,
  includes: [HTMLOrSVGElement],
  proto: {
    className: reflect("class", "Text"),
    ownerSVGElement: { ...ancestor, rustName: "owner_svg_element" },
    viewportElement: ancestor,
  },
});

export const SVGBoundingBoxOptions = b.dictionary(
  {
    clipped: b.bool.loose.default(false),
    fill: b.bool.loose.default(true),
    markers: b.bool.loose.default(false),
    stroke: b.bool.loose.default(false),
  },
  { webidl: true },
);

export const SVGGraphicsElement = b.interface("SVGGraphicsElement", {
  extends: SVGElement,
  proto: {
    transform: reflect("transform", "Transforms"),
    ...tests,
    nearestViewportElement: ancestor,
    farthestViewportElement: ancestor,
    getBBox: { rustName: "get_b_box", args: { options: SVGBoundingBoxOptions.default({}) }, returns: SVGRect, ...runs },
    getCTM: { rustName: "get_ctm", ...product },
    getScreenCTM: { rustName: "get_screen_ctm", ...product },
  },
});

export const SVGGeometryElement = b.interface("SVGGeometryElement", {
  extends: SVGGraphicsElement,
  proto: {
    ...numbers("pathLength"),
    isPointInFill: { args: { point }, returns: b.bool, ...runs },
    isPointInStroke: { args: { point }, returns: b.bool, ...runs },
    getTotalLength: { returns: b.float, ...runs },
    getPointAtLength: { args: floats("distance"), returns: SVGPoint, ...js },
  },
});

const charnum = index;
export const SVGTextContentElement = b.interface("SVGTextContentElement", {
  extends: SVGGraphicsElement,
  constants: constants("LENGTHADJUST_", "SPACING SPACINGANDGLYPHS"),
  proto: {
    ...lengths("textLength"),
    ...keyword("lengthAdjust", "spacing spacingAndGlyphs"),
    getNumberOfChars: { returns: b.i32, ...runs },
    getComputedTextLength: { returns: b.float, ...runs },
    getSubStringLength: { args: { charnum, nchars: index }, returns: b.float, ...js },
    getStartPositionOfChar: { args: { charnum }, returns: SVGPoint, ...js },
    getEndPositionOfChar: { args: { charnum }, returns: SVGPoint, ...js },
    getExtentOfChar: { args: { charnum }, returns: SVGRect, ...js },
    getRotationOfChar: { args: { charnum }, returns: b.float, ...js },
    getCharNumAtPosition: { args: { point }, returns: b.i32, ...runs },
    selectSubString: { args: { charnum, nchars: index }, ...js },
  },
});

export const SVGZoomAndPan = b.mixin("SVGZoomAndPan", {
  on: SVGElement,
  proto: { zoomAndPan: { getter: short, setter: runs } },
});
const zoomAndPan = { includes: [SVGZoomAndPan], constants: constants("SVG_ZOOMANDPAN_", "DISABLE MAGNIFY") };

const related = {
  args: { rect: SVGRect, referenceElement: b.ref("SVGElement").nullable },
  returns: b.ref("NodeList"),
  ...runs,
};
const relates = { args: { element: SVGElement, rect: SVGRect }, returns: b.bool, ...runs };
const creates = (name: string) => ({
  rustName: `create_svg_${name.toLowerCase()}`,
  returns: b.ref("SVG" + name),
  ...heap,
});

export const SVGSVGElement = b.interface("SVGSVGElement", {
  extends: SVGGraphicsElement,
  ...zoomAndPan,
  includes: [SVGZoomAndPan],
  proto: {
    ...lengths("x y"),
    ...percentages("width height", 100),
    ...fitted,
    currentScale: { getter: b.float, setter: runs },
    currentTranslate: { getter: SVGPoint.nullable, ...heap },
    getIntersectionList: related,
    getEnclosureList: related,
    checkIntersection: relates,
    checkEnclosure: relates,
    deselectAll: runs,
    ...Object.fromEntries(
      words("Number Length Angle Point Matrix Rect Transform").map(it => ["createSVG" + it, creates(it)]),
    ),
    createSVGTransformFromMatrix: fromMatrix,
    getElementById: { args: { elementId: b.DOMString.atom }, returns: b.ref("DomElement").nullable },
    suspendRedraw: { args: { maxWaitMilliseconds: index }, returns: b.u32 },
    unsuspendRedraw: { args: { suspendHandleID: index } },
    unsuspendRedrawAll: {},
    forceRedraw: {},
    pauseAnimations: runs,
    unpauseAnimations: runs,
    animationsPaused: { returns: b.bool, ...runs },
    getCurrentTime: { returns: b.float, ...runs },
    setCurrentTime: { args: floats("seconds"), ...runs },
  },
});

const plain = (proto = {}, more = {}) => ({ extends: SVGElement, proto, ...more });
const graphics = (proto = {}, more = {}) => ({ extends: SVGGraphicsElement, proto, ...more });
const geometry = (proto = {}) => ({ extends: SVGGeometryElement, proto });

export const SVGAElement = b.interface(
  "SVGAElement",
  graphics({
    ...strings("href target"),
    ...asInHtml("download ping rel hreflang type referrerPolicy"),
    relList: tokenList("rel", "noreferrer noopener opener"),
  }),
);
export const SVGForeignObjectElement = b.interface("SVGForeignObjectElement", graphics(box));
export const SVGImageElement = b.interface(
  "SVGImageElement",
  graphics({
    ...box,
    ...href,
    preserveAspectRatio,
    ...asInHtml("crossOrigin decoding"),
    decode: { returns: b.any.returning("Promise"), rejects: true, ...heap },
  }),
);
export const SVGUseElement = b.interface("SVGUseElement", graphics({ ...box, ...href }));
export const SVGSymbolElement = b.interface("SVGSymbolElement", graphics(fitted));
export const SVGGElement = b.interface("SVGGElement", graphics());
export const SVGDefsElement = b.interface("SVGDefsElement", graphics());
export const SVGSwitchElement = b.interface("SVGSwitchElement", graphics());
export const SVGCircleElement = b.interface("SVGCircleElement", geometry(lengths("cx cy r")));
export const SVGEllipseElement = b.interface("SVGEllipseElement", geometry(lengths("cx cy rx ry")));
export const SVGLineElement = b.interface("SVGLineElement", geometry(lengths("x1 y1 x2 y2")));
export const SVGRectElement = b.interface("SVGRectElement", geometry({ ...box, ...lengths("rx ry") }));
export const SVGPathElement = b.interface("SVGPathElement", geometry());
const points = { points: reflect("points", "Points"), animatedPoints: reflect("points", "Points", "animated") };
export const SVGPolygonElement = b.interface("SVGPolygonElement", geometry(points));
export const SVGPolylineElement = b.interface("SVGPolylineElement", geometry(points));

export const SVGTextPathElement = b.interface("SVGTextPathElement", {
  extends: SVGTextContentElement,
  constants: {
    ...constants("TEXTPATH_METHODTYPE_", "ALIGN STRETCH"),
    ...constants("TEXTPATH_SPACINGTYPE_", "AUTO EXACT"),
    ...constants("TEXTPATH_SIDETYPE_", "LEFT RIGHT"),
  },
  proto: {
    ...href,
    ...lengths("startOffset"),
    ...keyword("method", "align stretch"),
    ...keyword("spacing", "auto exact", 2),
    ...keyword("side", "left right"),
  },
});
export const SVGTextPositioningElement = b.interface("SVGTextPositioningElement", {
  extends: SVGTextContentElement,
  proto: {
    ...each("x y dx dy", name => reflect(name, `Lengths(${axisOf(name)})`)),
    rotate: reflect("rotate", "Numbers"),
  },
});
export const SVGTextElement = b.interface("SVGTextElement", { extends: SVGTextPositioningElement });
export const SVGTSpanElement = b.interface("SVGTSpanElement", { extends: SVGTextPositioningElement });

export const SVGGradientElement = b.interface("SVGGradientElement", {
  extends: SVGElement,
  constants: constants("SVG_SPREADMETHOD_", "PAD REFLECT REPEAT"),
  proto: {
    ...units("gradientUnits", 2),
    gradientTransform: reflect("gradientTransform", "Transforms"),
    ...keyword("spreadMethod", "pad reflect repeat"),
    ...href,
  },
});
export const SVGLinearGradientElement = b.interface("SVGLinearGradientElement", {
  extends: SVGGradientElement,
  proto: { ...percentages("x1 y1", 0), ...percentages("x2", 100), ...percentages("y2", 0) },
});
export const SVGRadialGradientElement = b.interface("SVGRadialGradientElement", {
  extends: SVGGradientElement,
  proto: { ...percentages("cx cy r fx fy", 50), ...percentages("fr", 0) },
});
export const SVGStopElement = b.interface("SVGStopElement", plain({ offset: reflect("offset", "NumberOrPercentage") }));
export const SVGClipPathElement = b.interface(
  "SVGClipPathElement",
  plain({ ...units("clipPathUnits", 1), transform: reflect("transform", "Transforms") }),
);
export const SVGFilterElement = b.interface(
  "SVGFilterElement",
  plain({ ...region, ...units("filterUnits", 2), ...units("primitiveUnits", 1), ...href }),
);
export const SVGMaskElement = b.interface(
  "SVGMaskElement",
  plain({ ...region, ...units("maskUnits", 2), ...units("maskContentUnits", 1), ...tests }),
);
export const SVGPatternElement = b.interface(
  "SVGPatternElement",
  plain({
    ...box,
    ...units("patternUnits", 2),
    ...units("patternContentUnits", 1),
    patternTransform: reflect("patternTransform", "Transforms"),
    ...href,
    ...tests,
    ...fitted,
  }),
);
export const SVGMarkerElement = b.interface("SVGMarkerElement", {
  extends: SVGElement,
  constants: {
    ...constants("SVG_MARKERUNITS_", "USERSPACEONUSE STROKEWIDTH"),
    ...constants("SVG_MARKER_ORIENT_", "AUTO ANGLE AUTO_START_REVERSE"),
  },
  proto: {
    ...lengths("refX refY"),
    ...asInHtml("orient"),
    ...keyword("markerUnits", "userSpaceOnUse strokeWidth", 2),
    ...lengths("markerWidth markerHeight", 3),
    orientType: reflect("orient", "OrientType"),
    orientAngle: reflect("orient", "OrientAngle"),
    ...fitted,
    setOrientToAuto: runs,
    setOrientToAngle: { args: { angle: SVGAngle }, ...runs },
  },
});
export const SVGScriptElement = b.interface("SVGScriptElement", plain({ ...href, ...asInHtml("type crossOrigin") }));
export const SVGStyleElement = b.interface("SVGStyleElement", plain(asInHtml("media type title")));
export const SVGDescElement = b.interface("SVGDescElement", plain());
export const SVGMetadataElement = b.interface("SVGMetadataElement", plain());
export const SVGTitleElement = b.interface("SVGTitleElement", plain());
export const SVGViewElement = b.interface("SVGViewElement", plain(fitted, zoomAndPan));
export const SVGMPathElement = b.interface("SVGMPathElement", plain(href));

// ───────────────────────────── filters ─────────────────────────────

export const SVGFEMergeNodeElement = b.interface("SVGFEMergeNodeElement", plain(in1));
export const SVGFEDistantLightElement = b.interface("SVGFEDistantLightElement", plain(numbers("azimuth elevation")));
export const SVGFEPointLightElement = b.interface("SVGFEPointLightElement", plain(numbers("x y z")));
export const SVGFESpotLightElement = b.interface(
  "SVGFESpotLightElement",
  plain({
    ...numbers("x y z pointsAtX pointsAtY pointsAtZ"),
    ...numbers("specularExponent", 1),
    ...numbers("limitingConeAngle"),
  }),
);

export const SVGFilterPrimitiveStandardAttributes = b.mixin("SVGFilterPrimitiveStandardAttributes", {
  on: SVGElement,
  proto: { ...percentages("x y", 0), ...percentages("width height", 100), ...strings("result") },
});
export const SVGStdDeviation = b.mixin("SVGStdDeviation", {
  on: SVGElement,
  proto: { setStdDeviation: { args: floats("stdDeviationX stdDeviationY"), ...runs } },
});
const filter = (proto = {}, constants = {}, ...mixins: (typeof SVGStdDeviation)[]) =>
  plain(proto, { constants, includes: [SVGFilterPrimitiveStandardAttributes, ...mixins] });
const inputs = { ...in1, ...strings("in2") };
const edgeMode = (initial: number) => keyword("edgeMode", "duplicate wrap none", initial);
const edgeModes = constants("SVG_EDGEMODE_", "DUPLICATE WRAP NONE");
const kernelUnitLength = numberPair("kernelUnitLength");
const named = (prefix: string, keywords: string) => constants(prefix, keywords.toUpperCase().replaceAll("-", "_"));

const modes = `normal multiply screen darken lighten overlay color-dodge color-burn hard-light soft-light difference
  exclusion hue saturation color luminosity`;
export const SVGFEBlendElement = b.interface(
  "SVGFEBlendElement",
  filter({ ...inputs, ...keyword("mode", modes) }, named("SVG_FEBLEND_MODE_", modes)),
);
const matrices = "matrix saturate hueRotate luminanceToAlpha";
export const SVGFEColorMatrixElement = b.interface(
  "SVGFEColorMatrixElement",
  filter(
    { ...in1, ...keyword("type", matrices), values: reflect("values", "Numbers") },
    named("SVG_FECOLORMATRIX_TYPE_", matrices),
  ),
);
export const SVGFEComponentTransferElement = b.interface("SVGFEComponentTransferElement", filter(in1));
const operators = "over in out atop xor arithmetic";
export const SVGFECompositeElement = b.interface(
  "SVGFECompositeElement",
  filter(
    { ...inputs, ...keyword("operator", operators), ...numbers("k1 k2 k3 k4") },
    named("SVG_FECOMPOSITE_OPERATOR_", operators),
  ),
);
export const SVGFEConvolveMatrixElement = b.interface(
  "SVGFEConvolveMatrixElement",
  filter(
    {
      ...in1,
      ...pair("order", "Order"),
      kernelMatrix: reflect("kernelMatrix", "Numbers"),
      ...numbers("divisor", 1),
      ...numbers("bias"),
      ...integers("targetX targetY"),
      ...edgeMode(1),
      preserveAlpha: reflect("preserveAlpha", "Boolean"),
      ...kernelUnitLength,
    },
    edgeModes,
  ),
);
export const SVGFEDiffuseLightingElement = b.interface(
  "SVGFEDiffuseLightingElement",
  filter({ ...in1, ...numbers("surfaceScale diffuseConstant", 1), ...kernelUnitLength }),
);
export const SVGFEDisplacementMapElement = b.interface(
  "SVGFEDisplacementMapElement",
  filter(
    {
      ...inputs,
      ...numbers("scale"),
      ...keyword("xChannelSelector", "R G B A", 4),
      ...keyword("yChannelSelector", "R G B A", 4),
    },
    constants("SVG_CHANNEL_", "R G B A"),
  ),
);
export const SVGFEDropShadowElement = b.interface(
  "SVGFEDropShadowElement",
  filter({ ...in1, ...numbers("dx dy", 2), ...numberPair("stdDeviation", 2) }, {}, SVGStdDeviation),
);
export const SVGFEFloodElement = b.interface("SVGFEFloodElement", filter());
export const SVGFEGaussianBlurElement = b.interface(
  "SVGFEGaussianBlurElement",
  filter({ ...in1, ...numberPair("stdDeviation"), ...edgeMode(3) }, edgeModes, SVGStdDeviation),
);
export const SVGFEImageElement = b.interface("SVGFEImageElement", filter({ preserveAspectRatio, ...href }));
export const SVGFEMergeElement = b.interface("SVGFEMergeElement", filter());
export const SVGFEMorphologyElement = b.interface(
  "SVGFEMorphologyElement",
  filter(
    { ...in1, ...keyword("operator", "erode dilate"), ...numberPair("radius") },
    constants("SVG_MORPHOLOGY_OPERATOR_", "ERODE DILATE"),
  ),
);
export const SVGFEOffsetElement = b.interface("SVGFEOffsetElement", filter({ ...in1, ...numbers("dx dy") }));
export const SVGFESpecularLightingElement = b.interface(
  "SVGFESpecularLightingElement",
  filter({ ...in1, ...numbers("surfaceScale specularConstant specularExponent", 1), ...kernelUnitLength }),
);
export const SVGFETileElement = b.interface("SVGFETileElement", filter(in1));
export const SVGFETurbulenceElement = b.interface(
  "SVGFETurbulenceElement",
  filter(
    {
      ...numberPair("baseFrequency"),
      ...integers("numOctaves", 1),
      ...numbers("seed"),
      ...keyword("stitchTiles", "stitch noStitch", 2),
      ...keyword("type", "fractalNoise turbulence", 2),
    },
    {
      ...constants("SVG_TURBULENCE_TYPE_", "FRACTALNOISE TURBULENCE"),
      ...constants("SVG_STITCHTYPE_", "STITCH NOSTITCH"),
    },
  ),
);
const transfers = "identity table discrete linear gamma";
export const SVGComponentTransferFunctionElement = b.interface("SVGComponentTransferFunctionElement", {
  extends: SVGElement,
  constants: named("SVG_FECOMPONENTTRANSFER_TYPE_", transfers),
  proto: {
    ...keyword("type", transfers),
    tableValues: reflect("tableValues", "Numbers"),
    ...numbers("slope", 1),
    ...numbers("intercept"),
    ...numbers("amplitude exponent", 1),
    ...numbers("offset"),
  },
});
export const SVGFEFuncRElement = b.interface("SVGFEFuncRElement", { extends: SVGComponentTransferFunctionElement });
export const SVGFEFuncGElement = b.interface("SVGFEFuncGElement", { extends: SVGComponentTransferFunctionElement });
export const SVGFEFuncBElement = b.interface("SVGFEFuncBElement", { extends: SVGComponentTransferFunctionElement });
export const SVGFEFuncAElement = b.interface("SVGFEFuncAElement", { extends: SVGComponentTransferFunctionElement });

// ───────────────────────────── animations ─────────────────────────────

export const SVGAnimationElement = b.interface("SVGAnimationElement", {
  extends: SVGElement,
  proto: {
    ...tests,
    targetElement: { ...ancestor, ...runs },
    getStartTime: { returns: b.float, ...js },
    getCurrentTime: { returns: b.float, ...runs },
    getSimpleDuration: { returns: b.float, ...js },
    beginElement: runs,
    beginElementAt: { args: floats("offset"), ...runs },
    endElement: runs,
    endElementAt: { args: floats("offset"), ...runs },
  },
});
export const SVGAnimateElement = b.interface("SVGAnimateElement", { extends: SVGAnimationElement });
export const SVGAnimateMotionElement = b.interface("SVGAnimateMotionElement", { extends: SVGAnimationElement });
export const SVGAnimateTransformElement = b.interface("SVGAnimateTransformElement", { extends: SVGAnimationElement });
export const SVGSetElement = b.interface("SVGSetElement", { extends: SVGAnimationElement });
