const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const nodes = require("internal/desktop/dom/node");
const html = require("internal/desktop/dom/html");
const loader = require("internal/desktop/dom/loader");
const { styleOf } = require("internal/desktop/dom/cssom");

const { Kind, SVG, domError, expose, getAttr, invalidate, kinds, same, splitTokens, tooFew, wrap, wrapOrNull } = core;
const { layout } = html;

type N = $Dom.N;

const values = () => require("internal/desktop/dom/svg_values");
for (const name of splitTokens(`Angle AnimatedAngle AnimatedBoolean AnimatedEnumeration AnimatedInteger AnimatedLength
  AnimatedLengthList AnimatedNumber AnimatedNumberList AnimatedPreserveAspectRatio AnimatedRect AnimatedString
  AnimatedTransformList Length LengthList Matrix Number NumberList Point PointList PreserveAspectRatio Rect StringList
  Transform TransformList UnitTypes`)) {
  new core.Interface("SVG" + name, () => (values(), core.interfaces["SVG" + name]));
}

function closest(node: N, names: RegExp): N | null {
  let it = core.parentOrHost(node);
  for (; it !== null && it.ns === SVG && it.name !== "foreignObject"; it = core.parentOrHost(it)) {
    if (names.test(it.name)) return it;
  }
  return null;
}

function defineReflected(ctor: any, properties: string) {
  for (const description of splitTokens(properties)) {
    const property = /^\w+/.exec(description)![0];
    const member: any = {
      get [property]() {
        if (!(this instanceof ctor) || this === ctor.prototype) throw new TypeError("Illegal invocation");
        return same(this.$impl, property, node => values().reflect(node, description));
      },
    };
    core.mixin(member, ctor);
  }
}

class SVGElement extends nodes.Element {
  get style(): any {
    return styleOf(this.$impl);
  }
  set style(text) {
    styleOf(this.$impl).cssText = text;
  }
  get ownerSVGElement() {
    return wrapOrNull(closest(this.$impl, /^svg$/));
  }
  get viewportElement() {
    return wrapOrNull(closest(this.$impl, /^(?:svg|symbol|image)$/));
  }
}
defineReflected(SVGElement, "className$class");
core.mixin(html.htmlOrSvg, SVGElement);
events.defineHandlers(SVGElement.prototype, events.globalHandlers);
kinds.svgElement = new Kind(expose(SVGElement));

type Extras = { members?: () => object; constants?: string[]; hooks?: object; isAbstract?: boolean };

function define(base: any, tag: string, properties = "", { members, constants = [], hooks, isAbstract }: Extras = {}) {
  const capitals = tag === "svg" ? 3 : tag.startsWith("fe") || tag === "tspan" || tag === "mpath" ? 2 : 1;
  const name = "SVG" + tag.slice(0, capitals).toUpperCase() + tag.slice(capitals) + "Element";
  const lazy = new core.Interface(name, () => {
    const Base = core.loaded(base);
    const ctor = { [name]: class extends Base {} }[name];
    const all = {};
    for (let i = 0; i < constants.length; i += 2)
      Object.assign(all, values().constants(constants[i], constants[i + 1]));
    defineReflected(expose(ctor, all), properties);
    if (members !== undefined) core.mixin(members(), ctor);
    return ctor;
  });
  if (!isAbstract) kinds.svg.$set(tag, new Kind(lazy, hooks));
  return lazy;
}

function matrixOf(node: N, toScreen: boolean) {
  const matrix = core.engineFor(node).svgMatrix(node.id, toScreen);
  return values().matrix(matrix.length === 6 ? Array.from(matrix) : [1, 0, 0, 1, 0, 0]);
}

const tests = "requiredExtensions systemLanguage";
const Graphics = define(SVGElement, "graphics", "transform " + tests, {
  isAbstract: true,
  members: (): any => ({
    get nearestViewportElement() {
      return wrapOrNull(closest(this.$impl, /^(?:svg|symbol)$/));
    },
    get farthestViewportElement() {
      let found: N | null = null;
      for (let it: N | null = this.$impl; (it = closest(it!, /^(?:svg|symbol)$/)) !== null;) found = it;
      return wrapOrNull(found);
    },
    getBBox(_options: any = undefined) {
      const { id } = this.$impl;
      return values().rect(Array.from(layout(this.$impl)?.svgBox(id, 0) ?? [0, 0, 0, 0]));
    },
    getCTM() {
      return matrixOf(this.$impl, false);
    },
    getScreenCTM() {
      return matrixOf(this.$impl, true);
    },
  }),
});

function pointFrom(init: any): number[] {
  if (init != null && !$isObject(init)) throw new TypeError("The provided value is not of type 'DOMPointInit'.");
  return [+(init?.x ?? 0), +(init?.y ?? 0)];
}

function contains(node: N, init: any, inStroke: boolean): boolean {
  const { id } = node;
  const [x, y] = pointFrom(init);
  return layout(node)?.svgContains(id, x, y, inStroke) ?? false;
}

function measure(node: N, distance: number) {
  const numbers = core.engineFor(node).svgPointAtLength(node.id, distance);
  if (numbers.length === 0) throw domError("InvalidStateError", "This element is non-rendered element.");
  return numbers;
}

const Geometry = define(Graphics, "geometry", "pathLength#0", {
  isAbstract: true,
  members: (): any => ({
    isPointInFill(point: any = undefined) {
      return contains(this.$impl, point, false);
    },
    isPointInStroke(point: any = undefined) {
      return contains(this.$impl, point, true);
    },
    getTotalLength() {
      return measure(this.$impl, 0)[0];
    },
    getPointAtLength(distance: number) {
      if ($argumentCount() < 1) tooFew(1);
      const [, x, y] = measure(this.$impl, values().float(distance));
      if (x !== x) throw domError("InvalidStateError", "The element's path is empty.");
      return values().point(x, y);
    },
  }),
});

const PER_CHARACTER = 10;

function characters(node: N): ArrayLike<number> {
  const { id } = node;
  return layout(node)?.svgCharacters(id) ?? [];
}

function charactersFrom(node: N, index: number): number[] {
  const rest = Array.from(characters(node)).slice((index >>> 0) * PER_CHARACTER);
  if (rest.length === 0) throw domError("IndexSizeError", `The charnum provided (${index}) is out of range.`);
  return rest;
}

function advance(numbers: ArrayLike<number>, count: number): number {
  let sum = 0;
  for (let i = 9; i < numbers.length && count-- > 0; i += PER_CHARACTER) sum += numbers[i];
  return Math.fround(sum);
}

const TextContent = define(Graphics, "textContent", "textLength lengthAdjust:1", {
  isAbstract: true,
  constants: ["LENGTHADJUST_", "SPACING SPACINGANDGLYPHS"],
  members: (): any => ({
    getNumberOfChars() {
      return characters(this.$impl).length / PER_CHARACTER;
    },
    getComputedTextLength() {
      return advance(characters(this.$impl), Infinity);
    },
    getSubStringLength(start: number, count: number) {
      if ($argumentCount() < 2) tooFew(2);
      return advance(charactersFrom(this.$impl, start), count >>> 0);
    },
    getStartPositionOfChar(index: number) {
      if ($argumentCount() < 1) tooFew(1);
      return values().point(...(charactersFrom(this.$impl, index) as [number, number]));
    },
    getEndPositionOfChar(index: number) {
      if ($argumentCount() < 1) tooFew(1);
      return values().point(...(charactersFrom(this.$impl, index).slice(2) as [number, number]));
    },
    getExtentOfChar(index: number) {
      if ($argumentCount() < 1) tooFew(1);
      return values().rect(charactersFrom(this.$impl, index).slice(4, 8));
    },
    getRotationOfChar(index: number) {
      if ($argumentCount() < 1) tooFew(1);
      return charactersFrom(this.$impl, index)[8];
    },
    getCharNumAtPosition(point: any = undefined) {
      const all = characters(this.$impl);
      const [x, y] = pointFrom(point);
      let found = -1;
      for (let i = 0; i < all.length; i += PER_CHARACTER) {
        const isInside =
          x >= all[i + 4] && y >= all[i + 5] && x <= all[i + 4] + all[i + 6] && y <= all[i + 5] + all[i + 7];
        if (isInside && (all[i + 9] !== 0 || found < 0)) found = i / PER_CHARACTER;
      }
      return found;
    },
    selectSubString(start: number, count: number) {
      if ($argumentCount() < 2) tooFew(2);
      const end = (start >>>= 0) + Math.min(count >>> 0, charactersFrom(this.$impl, start).length / PER_CHARACTER);
      const texts = core.filterDescendants(this.$impl, node => node.type === core.TEXT);
      function locate(offset: number): [any, number] {
        const last = texts.at(-1);
        for (const text of texts) {
          if (offset <= text.data.length || text === last) return [wrap(text), Math.min(offset, text.data.length)];
          offset -= text.data.length;
        }
        return [null, 0];
      }
      this.ownerDocument.getSelection()?.setBaseAndExtent(...locate(start), ...locate(end));
    },
  }),
});

// ───────────────────────────── svg ─────────────────────────────

let isClockSet = false;

function control(node: N, operation: number, value = 0): ArrayLike<number> {
  const engine = core.engineFor(node);
  if (!isClockSet && node.doc.page !== null) {
    isClockSet = true;
    queueMicrotask(() => (isClockSet = false));
    engine.controlSmil(0, 9, performance.now());
  }
  const result = engine.controlSmil(node.id, operation, value);
  if (node.doc.page !== null && operation !== 1 && operation !== 8) invalidate(node.doc);
  return result;
}

class Zoom {
  node: N;
  isReadOnly = false;
  scale = 1;
  translation = values().ownedPoint(this);

  constructor(node: N) {
    this.node = node;
  }
  refresh() {}
  commit() {
    const { node } = this;
    if (node.parent !== node.doc.node) return;
    layout(node)?.setSvgZoom(this.scale, this.translation.x, this.translation.y);
    if (node.doc.page !== null) invalidate(node.doc);
  }
}
const zoomOf = (node: N): Zoom => same(node, "zoom", it => new Zoom(it));

const rendered = /^(?:circle|ellipse|foreignObject|image|line|path|polygon|polyline|rect|text|use)$/;

function rectFrom(value: any): number[] {
  if (!(value instanceof values().SVGRect)) throw new TypeError("The provided value is not of type 'SVGRect'.");
  return value.$impl.read();
}

/** `rect` is in the initial coordinate system of `svg`. */
function relates(svg: N, node: N, [x, y, width, height]: number[], encloses: boolean): boolean {
  const engine = layout(node);
  if (engine === null || !rendered.test(node.name) || html.boundingRect(node)[2] + html.boundingRect(node)[3] === 0)
    return false;
  if (!encloses && engine.computedStyle(node.id, "", "pointer-events") === "none") return false;
  const [left, top, across, down] = engine.svgBox(node.id, 2);
  const toSvg = matrixOf(svg, false).multiply(matrixOf(svg, true).inverse()).multiply(matrixOf(node, true));
  const nested = closest(svg, /^svg$/) === null ? toSvg : matrixOf(svg, false).inverse().multiply(toSvg);
  const corners = [0, 1, 2, 3].map(i =>
    values()
      .point(left + (i & 1) * across, top + (i >> 1) * down)
      .matrixTransform(nested),
  );
  const [xs, ys] = [corners.map(it => it.x), corners.map(it => it.y)];
  const [minX, minY, maxX, maxY] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  if (encloses) return x <= minX && y <= minY && maxX <= x + width && maxY <= y + height;
  return minX < x + width && x < maxX && minY < y + height && y < maxY;
}

function related(svg: N, rect: any, reference: any, encloses: boolean) {
  const area = rectFrom(rect);
  let root = reference == null ? svg : core.unwrap(reference, "getIntersectionList", 2);
  if (!core.contains(svg, root)) {
    if (!core.contains(root, svg)) return nodes.staticList([]);
    root = svg;
  }
  return nodes.staticList(core.filterDescendants(root, node => node.ns === SVG && relates(svg, node, area, encloses)));
}

const box = "x y width height";
const fitted = " viewBox preserveAspectRatio";
const zoomAndPan: any = {
  get zoomAndPan() {
    return getAttr(this.$impl, "zoomAndPan") === "disable" ? 1 : 2;
  },
  set zoomAndPan(value) {
    if (value === 1 || value === 2) core.setAttr(this.$impl, "zoomAndPan", value === 1 ? "disable" : "magnify");
  },
};

const Svg = define(Graphics, "svg", "x y width=100% height=100%" + fitted, {
  constants: ["SVG_ZOOMANDPAN_", "DISABLE MAGNIFY"],
  members: (): any => ({
    get currentScale() {
      return zoomOf(this.$impl).scale;
    },
    set currentScale(value) {
      value = values().float(value);
      if (this.$impl.parent !== this.$impl.doc.node) return;
      zoomOf(this.$impl).scale = value;
      zoomOf(this.$impl).commit();
    },
    get currentTranslate() {
      return zoomOf(this.$impl).translation;
    },
    getIntersectionList(rect: any, reference: any) {
      if ($argumentCount() < 2) tooFew(2);
      return related(this.$impl, rect, reference, false);
    },
    getEnclosureList(rect: any, reference: any) {
      if ($argumentCount() < 2) tooFew(2);
      return related(this.$impl, rect, reference, true);
    },
    checkIntersection(element: any, rect: any) {
      return relates(this.$impl, core.unwrap(element, "checkIntersection"), rectFrom(rect), false);
    },
    checkEnclosure(element: any, rect: any) {
      return relates(this.$impl, core.unwrap(element, "checkEnclosure"), rectFrom(rect), true);
    },
    deselectAll() {
      wrap(this.$impl.doc.node).getSelection()?.removeAllRanges();
    },
    getElementById(id: string) {
      if ($argumentCount() < 1) tooFew(1);
      id = `${id}`;
      return wrapOrNull(id === "" ? null : core.findDescendant(this.$impl, node => getAttr(node, "id") === id));
    },
    createSVGNumber() {
      return core.unwrap(this, "createSVGNumber") && values().number();
    },
    createSVGLength() {
      return core.unwrap(this, "createSVGLength") && values().length();
    },
    createSVGAngle() {
      return core.unwrap(this, "createSVGAngle") && values().angle();
    },
    createSVGPoint() {
      return core.unwrap(this, "createSVGPoint") && values().point(0, 0);
    },
    createSVGMatrix() {
      return core.unwrap(this, "createSVGMatrix") && values().matrix([1, 0, 0, 1, 0, 0]);
    },
    createSVGRect() {
      return core.unwrap(this, "createSVGRect") && values().rect([0, 0, 0, 0]);
    },
    createSVGTransform() {
      return core.unwrap(this, "createSVGTransform") && values().transform();
    },
    createSVGTransformFromMatrix(matrix: any = undefined) {
      return core.unwrap(this, "createSVGTransformFromMatrix") && values().transform(matrix);
    },
    suspendRedraw(_milliseconds: number) {
      if ($argumentCount() < 1) tooFew(1);
      return core.unwrap(this, "suspendRedraw") && 1;
    },
    unsuspendRedraw(_handle: number) {
      if ($argumentCount() < 1) tooFew(1);
      core.unwrap(this, "unsuspendRedraw");
    },
    unsuspendRedrawAll() {
      core.unwrap(this, "unsuspendRedrawAll");
    },
    forceRedraw() {
      core.unwrap(this, "forceRedraw");
    },
    pauseAnimations() {
      control(this.$impl, 3, 1);
    },
    unpauseAnimations() {
      control(this.$impl, 3, 0);
    },
    animationsPaused() {
      return control(this.$impl, 1)[1] !== 0;
    },
    getCurrentTime() {
      return Math.fround(control(this.$impl, 1)[0]);
    },
    setCurrentTime(seconds: number) {
      if ($argumentCount() < 1) tooFew(1);
      control(this.$impl, 2, Math.max(values().float(seconds), 0));
    },
  }),
});
core.mixin(zoomAndPan, Svg);
core.extend(Svg, ctor => events.defineHandlers(ctor.prototype, events.windowHandlers, true));

// ───────────────────────────── other elements ─────────────────────────────

const A = define(Graphics, "a", "href$ target$", { hooks: html.followsLink });
core.extend(A, ctor => html.reflectAll(ctor, "download ping rel hreflang type referrerPolicy"));
nodes.defineTokenList(A, "relList", "rel", ["noreferrer", "noopener", "opener"]);
define(Graphics, "foreignObject", box);
const Image = define(Graphics, "image", box + " href$ preserveAspectRatio", { hooks: loader.svgImageHooks });
core.extend(Image, ctor => html.reflectAll(ctor, "crossOrigin decoding"));
core.mixin(loader.svgImageMembers, Image);
define(Graphics, "use", box + " href$", { hooks: loader.useHooks });
define(Graphics, "symbol", fitted);
for (const tag of ["g", "defs", "switch"]) define(Graphics, tag);
define(Geometry, "circle", "cx cy r");
define(Geometry, "ellipse", "cx cy rx ry");
define(Geometry, "line", "x1 y1 x2 y2");
define(Geometry, "rect", box + " rx ry");
define(Geometry, "path");
for (const tag of ["polygon", "polyline"]) define(Geometry, tag, "points animatedPoints");
define(TextContent, "textPath", "href$ startOffset method:1 spacing:2 side:1", {
  constants: [
    "TEXTPATH_METHODTYPE_",
    "ALIGN STRETCH",
    "TEXTPATH_SPACINGTYPE_",
    "AUTO EXACT",
    "TEXTPATH_SIDETYPE_",
    "LEFT RIGHT",
  ],
});
const Positioned = define(TextContent, "textPositioning", "x* y* dx* dy* rotate*#", { isAbstract: true });
for (const tag of ["text", "tspan"]) define(Positioned, tag);
const Gradient = define(SVGElement, "gradient", "gradientUnits:units2 gradientTransform spreadMethod:1 href$", {
  isAbstract: true,
  constants: ["SVG_SPREADMETHOD_", "PAD REFLECT REPEAT"],
});
define(Gradient, "linearGradient", "x1=0% y1=0% x2=100% y2=0%");
define(Gradient, "radialGradient", "cx=50% cy=50% r=50% fx=50% fy=50% fr=0%");
const region = "x=-10% y=-10% width=120% height=120% ";
define(SVGElement, "clipPath", "clipPathUnits:units1 transform");
define(SVGElement, "filter", region + "filterUnits:units2 primitiveUnits:units1 href$");
define(SVGElement, "mask", region + "maskUnits:units2 maskContentUnits:units1 " + tests);
define(
  SVGElement,
  "pattern",
  `${box} patternUnits:units2 patternContentUnits:units1 patternTransform href$ ${tests}${fitted}`,
);
const Marker = define(
  SVGElement,
  "marker",
  "refX refY markerUnits:2 markerWidth=3 markerHeight=3 orientType orientAngle" + fitted,
  {
    constants: [
      "SVG_MARKERUNITS_",
      "USERSPACEONUSE STROKEWIDTH",
      "SVG_MARKER_ORIENT_",
      "AUTO ANGLE AUTO_START_REVERSE",
    ],
    members: (): any => ({
      setOrientToAuto() {
        core.setAttr(this.$impl, "orient", "auto");
      },
      setOrientToAngle(angle: any) {
        if (!(angle instanceof values().SVGAngle)) throw new TypeError("parameter 1 is not of type 'SVGAngle'.");
        core.setAttr(this.$impl, "orient", angle.valueAsString);
      },
    }),
  },
);
core.extend(Marker, ctor => html.reflectAll(ctor, "orient"));
define(SVGElement, "stop", "offset#0");
const Script = define(SVGElement, "script", "href$", { hooks: loader.scriptHooks });
core.extend(Script, ctor => html.reflectAll(ctor, "type~ crossOrigin"));
const Style = define(SVGElement, "style", "", { hooks: loader.styleHooks });
core.extend(Style, ctor => html.reflectAll(ctor, "media type title"));
core.mixin(loader.hasSheet, Style);
core.mixin(loader.styleMembers, Style);
for (const tag of ["desc", "metadata", "title"]) define(SVGElement, tag);
core.mixin(zoomAndPan, define(SVGElement, "view", fitted, { constants: ["SVG_ZOOMANDPAN_", "DISABLE MAGNIFY"] }));
define(SVGElement, "mpath", "href$");
define(SVGElement, "feMergeNode", "in1$in");
define(SVGElement, "feDistantLight", "azimuth#0 elevation#0");
define(SVGElement, "fePointLight", "x#0 y#0 z#0");
define(
  SVGElement,
  "feSpotLight",
  "x#0 y#0 z#0 pointsAtX#0 pointsAtY#0 pointsAtZ#0 specularExponent#1 limitingConeAngle#0",
);

function primitive(tag: string, properties: string, constants?: string[], members?: () => object) {
  return define(SVGElement, tag, "x=0% y=0% width=100% height=100% result$ " + properties, { constants, members });
}
function setsPair(method: string, attribute: string) {
  return (): any => ({
    [method](x: number, y: number) {
      core.setAttr(this.$impl, attribute, `${values().float(x)} ${values().float(y)}`);
    },
  });
}
const edgeModes = ["SVG_EDGEMODE_", "DUPLICATE WRAP NONE"];
const kernelUnit = " kernelUnitLengthX#0 kernelUnitLengthY#0";
primitive("feBlend", "in1$in in2$ mode:1", [
  "SVG_FEBLEND_MODE_",
  `NORMAL MULTIPLY SCREEN DARKEN LIGHTEN OVERLAY COLOR_DODGE COLOR_BURN HARD_LIGHT SOFT_LIGHT DIFFERENCE EXCLUSION HUE
  SATURATION COLOR LUMINOSITY`,
]);
primitive("feColorMatrix", "in1$in type:colorMatrix1 values*#", [
  "SVG_FECOLORMATRIX_TYPE_",
  "MATRIX SATURATE HUEROTATE LUMINANCETOALPHA",
]);
primitive("feComponentTransfer", "in1$in");
primitive("feComposite", "in1$in in2$ operator:composite1 k1#0 k2#0 k3#0 k4#0", [
  "SVG_FECOMPOSITE_OPERATOR_",
  "OVER IN OUT ATOP XOR ARITHMETIC",
]);
primitive(
  "feConvolveMatrix",
  "in1$in orderX!3 orderY!3 kernelMatrix*# divisor#1 bias#0 targetX!0 targetY!0 edgeMode:1 preserveAlpha" + kernelUnit,
  edgeModes,
);
primitive("feDiffuseLighting", "in1$in surfaceScale#1 diffuseConstant#1" + kernelUnit);
primitive("feDisplacementMap", "in1$in in2$ scale#0 xChannelSelector:channel4 yChannelSelector:channel4", [
  "SVG_CHANNEL_",
  "R G B A",
]);
const setsDeviation = setsPair("setStdDeviation", "stdDeviation");
primitive("feDropShadow", "in1$in dx#2 dy#2 stdDeviationX#2 stdDeviationY#2", undefined, setsDeviation);
primitive("feFlood", "");
primitive("feGaussianBlur", "in1$in stdDeviationX#0 stdDeviationY#0 edgeMode:3", edgeModes, setsDeviation);
primitive("feImage", "preserveAspectRatio href$");
primitive("feMerge", "");
primitive("feMorphology", "in1$in operator:morphology1 radiusX#0 radiusY#0", [
  "SVG_MORPHOLOGY_OPERATOR_",
  "ERODE DILATE",
]);
primitive("feOffset", "in1$in dx#0 dy#0");
primitive("feSpecularLighting", "in1$in surfaceScale#1 specularConstant#1 specularExponent#1" + kernelUnit);
primitive("feTile", "in1$in");
primitive("feTurbulence", "baseFrequencyX#0 baseFrequencyY#0 numOctaves!1 seed#0 stitchTiles:2 type:turbulence2", [
  "SVG_TURBULENCE_TYPE_",
  "FRACTALNOISE TURBULENCE",
  "SVG_STITCHTYPE_",
  "STITCH NOSTITCH",
]);
const Transfer = define(
  SVGElement,
  "componentTransferFunction",
  "type:transfer1 tableValues*# slope#1 intercept#0 amplitude#1 exponent#1 offset#0",
  { isAbstract: true, constants: ["SVG_FECOMPONENTTRANSFER_TYPE_", "IDENTITY TABLE DISCRETE LINEAR GAMMA"] },
);
for (const channel of "RGBA") define(Transfer, "feFunc" + channel);

// ───────────────────────────── animations ─────────────────────────────

function targetOf(node: N): N | null {
  if (!(node.flags & core.flags.CONNECTED)) return null;
  const href = core.svgHref(node);
  const url = href ? URL.parse(href, node.doc.baseUrl) : null;
  const isHere = href?.startsWith("#") || url?.href.split("#")[0] === node.doc.url.split("#")[0];
  const target = !href
    ? node.parent
    : isHere
      ? core.elementById(node.scope, decodeURIComponent(url?.hash.slice(1) ?? href.slice(1)))
      : null;
  return target?.ns === SVG ? target : null;
}

const { addEventListener, removeEventListener } = events.EventTarget.prototype;
const eventCondition =
  /^\s*(?:((?:\\.|[^.\\])+)\.)?((?:\\.|[^+\-.\\\s])+)\s*(?:([+-])\s*(\d*\.?\d+)(ms|s|min|h)?)?\s*$/;

/** For the conditions in `begin` and `end` that are about events. */
function listen(node: N) {
  for (const stop of node.x.splice(0)) stop();
  if (!(node.flags & core.flags.CONNECTED) || node.doc.page === null) return;
  for (const attribute of ["begin", "end"]) {
    for (const condition of getAttr(node, attribute)?.split(";") ?? []) {
      const [, id, type, sign, amount, unit = "s"] = eventCondition.exec(condition) ?? [];
      if (type === undefined || /^(?:\d|indefinite$|repeat\()/.test(type) || /^\d*$/.test(id ?? "x")) continue;
      if (id !== undefined && (type === "begin" || type === "end")) continue;
      const base = id === undefined ? targetOf(node) : core.elementById(node.scope, id.replace(/\\/g, ""));
      if (base === null) continue;
      const offset = sign === undefined ? 0 : +(sign + amount) * { ms: 0.001, s: 1, min: 60, h: 3600 }[unit]!;
      const [target, name] = [wrap(base), type.replace(/\\/g, "")];
      const listener = () => control(node, attribute === "begin" ? 6 : 7, offset);
      addEventListener.$call(target, name, listener);
      node.x.push(() => removeEventListener.$call(target, name, listener));
    }
  }
}

function listenUnlessParsing(node: N) {
  if (node.doc.readyState !== "loading") listen(node);
  else addEventListener.$call(wrap(node.doc.node), "readystatechange", () => listen(node), { once: true });
}

const animationHooks = {
  created: (node: N) => (node.x = []),
  inserted: listenUnlessParsing,
  removed: listen,
  attribute(node: N, name: string) {
    if ((name === "begin" || name === "end" || name === "href") && node.doc.readyState !== "loading") listen(node);
  },
};

const Animation = define(SVGElement, "animation", tests, {
  isAbstract: true,
  members: (): any => ({
    get targetElement() {
      return wrapOrNull(targetOf(this.$impl));
    },
    getStartTime() {
      const time = control(this.$impl, 8)[0];
      if (time === Infinity) throw domError("InvalidStateError", "No current interval.");
      return Math.fround(time);
    },
    getCurrentTime() {
      return Math.fround(control(this.$impl, 8)[1]);
    },
    getSimpleDuration() {
      const time = control(this.$impl, 8)[2];
      if (time === Infinity) throw domError("NotSupportedError", "No simple duration defined.");
      return Math.fround(time);
    },
    beginElement() {
      control(this.$impl, 4);
    },
    beginElementAt(offset: number) {
      control(this.$impl, 4, values().float(offset));
    },
    endElement() {
      control(this.$impl, 5);
    },
    endElementAt(offset: number) {
      control(this.$impl, 5, values().float(offset));
    },
  }),
});
core.extend(Animation, ctor => events.defineHandlers(ctor.prototype, ["begin", "end", "repeat"]));
for (const tag of ["animate", "animateMotion", "animateTransform", "set"])
  define(Animation, tag, "", { hooks: animationHooks });

export default {};
