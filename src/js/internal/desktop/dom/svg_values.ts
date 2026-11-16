const core = require("internal/desktop/dom/core");
const { supportsDeclaration } = require("internal/desktop/dom/engine");
const { finite } = require("internal/desktop/dom/events");
const { iterable, kList, makeList } = require("internal/desktop/dom/node");
const { layout } = require("internal/desktop/dom/html");

const { domError, expose, getAttr, illegalConstructor, react, setAttr, splitTokens, tooFew } = core;

type N = $Dom.N;
type Numbers = number[];
type Length = { value: number; unit: string; axis: number };
type Transform = { type: number; angle: number; center: Numbers; m: Numbers };

const float = (value: any): number => finite(Math.fround(+value));
const show = (value: number): string => "" + +value.toPrecision(6);
const NUMBER = "[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const SPACE = "[ \\t\\n\\r\\f]*";
const nextNumber = new RegExp(`${SPACE}(${NUMBER})${SPACE}(,?)`, "y");
const dimension = new RegExp(`^${SPACE}(${NUMBER})([a-zA-Z%]*)${SPACE}$`);

/** Null if there is anything else. */
function parseNumbers(text: string): Numbers | null {
  const numbers: Numbers = [];
  let at = 0;
  for (let match; (nextNumber.lastIndex = at), (match = nextNumber.exec(text)) !== null; at = nextNumber.lastIndex) {
    numbers.push(Math.fround(+match[1]));
  }
  return splitTokens(text.slice(at)).length === 0 && numbers.every(Number.isFinite) ? numbers : null;
}

function constants(prefix: string, names: string): Record<string, number> {
  return Object.fromEntries(["UNKNOWN", ...splitTokens(names)].map((it, i) => [prefix + it, i]));
}

interface Owner {
  node: N | null;
  isReadOnly: boolean;
  refresh(): void;
  commit(): void;
}

class Value<T> {
  data: T;
  owner: Owner | null;

  constructor(data: T, owner: Owner | null) {
    this.data = data;
    this.owner = owner;
  }
  read(): T {
    this.owner?.refresh();
    return this.data;
  }
  edit(): T {
    if (this.owner?.isReadOnly) throw domError("NoModificationAllowedError", "The attribute is read-only.");
    return this.read();
  }
  commit() {
    this.owner?.commit();
  }
}

function make<T>(ctor: any, impl: T): any {
  const object = Object.create(ctor.prototype);
  object.$impl = impl;
  return object;
}

/** An interface that is made of numbers. */
function numeric(name: string, fields: string, convert = float): any {
  const ctor = {
    [name]: class {
      constructor() {
        illegalConstructor();
      }
    },
  }[name];
  splitTokens(fields).forEach((field, index) => {
    const members: any = {
      get [field]() {
        return this.$impl.read()[index];
      },
      set [field](value) {
        value = convert(value);
        this.$impl.edit()[index] = value;
        this.$impl.commit();
      },
    };
    core.mixin(members, ctor);
  });
  return expose(ctor);
}

const SVGNumber = numeric("SVGNumber", "value");
const SVGPoint = numeric("SVGPoint", "x y");
const SVGRect = numeric("SVGRect", "x y width height");
const SVGMatrix = numeric("SVGMatrix", "a b c d e f", finite);
const point = (x: number, y: number) => make(SVGPoint, new Value([x, y], null));
const rect = (values: Numbers) => make(SVGRect, new Value(values, null));
const matrix = (values: Numbers) => make(SVGMatrix, new Value(values, null));

function multiply([a, b, c, d, e, f]: Numbers, [g, h, i, j, k, l]: Numbers): Numbers {
  return [a * g + c * h, b * g + d * h, a * i + c * j, b * i + d * j, a * k + c * l + e, b * k + d * l + f];
}

/** https://drafts.fxtf.org/geometry/#matrix-validate-and-fixup-2d */
function matrixFrom(init: any): Numbers {
  if (init != null && !$isObject(init)) throw new TypeError("The provided value is not of type 'DOMMatrix2DInit'.");
  return ["m11", "m12", "m21", "m22", "m41", "m42"].map((name, i) => {
    const [short, long] = [init?.["abcdef"[i]], init?.[name]];
    if (short !== undefined && long !== undefined && +short !== +long && !(short !== short && long !== long)) {
      throw new TypeError(`The ${"abcdef"[i]} and ${name} members disagree.`);
    }
    return +(long ?? short ?? (i === 0 || i === 3 ? 1 : 0));
  });
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
function rotation(degrees: number): Numbers {
  const [sin, cos] = [Math.sin(radians(degrees)), Math.cos(radians(degrees))];
  return [cos, sin, -sin, cos, 0, 0];
}
const after = (self: any, other: Numbers) => matrix(multiply(self.$impl.read(), other));

core.mixin(
  {
    multiply(other: any = undefined) {
      return after(this, matrixFrom(other));
    },
    inverse(this: any) {
      const [a, b, c, d, e, f] = this.$impl.read();
      const det = a * d - b * c;
      if (det === 0 || !Number.isFinite(det)) throw domError("InvalidStateError", "The matrix is not invertible.");
      return matrix([d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]);
    },
    translate(x: number, y: number) {
      return after(this, [1, 0, 0, 1, float(x), float(y)]);
    },
    scale(factor: number) {
      return after(this, [float(factor), 0, 0, float(factor), 0, 0]);
    },
    scaleNonUniform(x: number, y: number) {
      return after(this, [float(x), 0, 0, float(y), 0, 0]);
    },
    rotate(angle: number) {
      return after(this, rotation(float(angle)));
    },
    rotateFromVector(x: number, y: number) {
      if (float(x) === 0 || float(y) === 0) throw domError("InvalidAccessError", "Arguments cannot be zero.");
      return after(this, rotation((Math.atan2(y, x) * 180) / Math.PI));
    },
    flipX() {
      return after(this, [-1, 0, 0, 1, 0, 0]);
    },
    flipY() {
      return after(this, [1, 0, 0, -1, 0, 0]);
    },
    skewX(angle: number) {
      return after(this, [1, 0, Math.tan(radians(float(angle))), 1, 0, 0]);
    },
    skewY(angle: number) {
      return after(this, [1, Math.tan(radians(float(angle))), 0, 1, 0, 0]);
    },
  },
  SVGMatrix,
);

core.mixin(
  {
    matrixTransform(this: any, init: any = undefined) {
      const [, , , , x, y] = multiply(matrixFrom(init), [1, 0, 0, 1, ...this.$impl.read()]);
      return point(Math.fround(x), Math.fround(y));
    },
  },
  SVGPoint,
);

// ───────────────────────────── lengths and angles ─────────────────────────────

const lengthUnits = ["?", "", "%", "em", "ex", "px", "cm", "mm", "in", "pt", "pc"];
const pixelsIn = { "": 1, px: 1, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6, in: 96, pt: 96 / 72, pc: 16 };
const relativeUnit = /^(?:%|r?(?:em|ex|ch|ic|cap|lh)|[sld]?v(?:w|h|i|b|min|max)|cq(?:w|h|i|b|min|max))$/;
const isCalculated = (it: Length) => it.unit.endsWith(")");

function parseLength(text: string, axis: number): Length | null {
  const match = dimension.exec(text);
  if (match === null) {
    const isMath = /^\s*[a-z-]+\(.*\)\s*$/is.test(text) && supportsDeclaration("x", text);
    return isMath ? { value: 0, unit: text.trim(), axis } : null;
  }
  const unit = match[2].toLowerCase();
  const value = Math.fround(+match[1]);
  return Number.isFinite(value) && (unit in pixelsIn || relativeUnit.test(unit)) ? { value, unit, axis } : null;
}
const writeLength = (it: Length) => (isCalculated(it) ? it.unit : show(it.value) + it.unit);

function resolve(impl: Value<Length>, text: string): number {
  const node = impl.owner?.node;
  const pixels = node && layout(node)?.svgLength(node.id, text, impl.data.axis);
  if (pixels == null) throw domError("NotSupportedError", "Could not resolve relative length.");
  return pixels || 0;
}

function lengthUnit(type: number): string {
  const unit = lengthUnits[type & 0xffff];
  if (unit === undefined || unit === "?") throw domError("NotSupportedError", `Unknown or invalid units (${type}).`);
  return unit;
}

class SVGLength {
  declare $impl: Value<Length>;

  constructor() {
    illegalConstructor();
  }
  get unitType() {
    return Math.max(0, lengthUnits.indexOf(this.$impl.read().unit));
  }
  get value() {
    const it = this.$impl.read();
    return Math.fround(it.unit in pixelsIn ? it.value * pixelsIn[it.unit] : resolve(this.$impl, writeLength(it)));
  }
  set value(value) {
    value = float(value);
    const it = this.$impl.edit();
    if (isCalculated(it)) it.unit = "";
    it.value = Math.fround(value / (pixelsIn[it.unit] ?? resolve(this.$impl, "100" + it.unit) / 100)) || 0;
    this.$impl.commit();
  }
  get valueInSpecifiedUnits() {
    return this.$impl.read().value;
  }
  set valueInSpecifiedUnits(value) {
    value = float(value);
    const it = this.$impl.edit();
    it.value = value;
    if (isCalculated(it)) it.unit = "";
    this.$impl.commit();
  }
  get valueAsString() {
    return writeLength(this.$impl.read());
  }
  set valueAsString(text) {
    text = `${text}`;
    const it = this.$impl.edit();
    const parsed = parseLength(text, it.axis);
    if (parsed === null) throw domError("SyntaxError", `The value provided ('${text}') is invalid.`);
    Object.assign(it, parsed);
    this.$impl.commit();
  }
  newValueSpecifiedUnits(type: number, value: number) {
    if ($argumentCount() < 2) tooFew(2);
    value = float(value);
    Object.assign(this.$impl.edit(), { value, unit: lengthUnit(type) });
    this.$impl.commit();
  }
  convertToSpecifiedUnits(type: number) {
    if ($argumentCount() < 1) tooFew(1);
    const it = this.$impl.edit();
    const unit = lengthUnit(type);
    const value = this.value / (pixelsIn[unit] ?? resolve(this.$impl, "100" + unit) / 100);
    Object.assign(it, { value: Number.isFinite(value) ? Math.fround(value) : 0, unit });
    this.$impl.commit();
  }
}
expose(SVGLength, constants("SVG_LENGTHTYPE_", "NUMBER PERCENTAGE EMS EXS PX CM MM IN PT PC"));

type Angle = { value: number; unit: string };
const angleUnits = ["?", "", "deg", "rad", "grad"];
const degreesIn = { "": 1, deg: 1, rad: 180 / Math.PI, grad: 0.9, turn: 360 };

function parseAngle(text: string): Angle | null {
  const match = dimension.exec(text);
  return match !== null && match[2] in degreesIn ? { value: Math.fround(+match[1]), unit: match[2] } : null;
}

function angleUnit(type: number): string {
  const unit = angleUnits[type & 0xffff];
  if (unit === undefined || unit === "?") throw domError("NotSupportedError", `Unknown or invalid units (${type}).`);
  return unit;
}

class SVGAngle {
  declare $impl: Value<Angle>;

  constructor() {
    illegalConstructor();
  }
  get unitType() {
    return Math.max(0, angleUnits.indexOf(this.$impl.read().unit));
  }
  get value() {
    const it = this.$impl.read();
    return Math.fround(it.value * degreesIn[it.unit]);
  }
  set value(value) {
    value = float(value);
    const it = this.$impl.edit();
    it.value = Math.fround(value / degreesIn[it.unit]);
    this.$impl.commit();
  }
  get valueInSpecifiedUnits() {
    return this.$impl.read().value;
  }
  set valueInSpecifiedUnits(value) {
    value = float(value);
    this.$impl.edit().value = value;
    this.$impl.commit();
  }
  get valueAsString() {
    const it = this.$impl.read();
    return show(it.value) + it.unit;
  }
  set valueAsString(text) {
    text = `${text}`;
    const it = this.$impl.edit();
    const parsed = text === "" ? { value: 0, unit: "" } : parseAngle(text);
    if (parsed === null) throw domError("SyntaxError", `The value provided ('${text}') is invalid.`);
    Object.assign(it, parsed);
    this.$impl.commit();
  }
  newValueSpecifiedUnits(type: number, value: number) {
    if ($argumentCount() < 2) tooFew(2);
    value = float(value);
    Object.assign(this.$impl.edit(), { value, unit: angleUnit(type) });
    this.$impl.commit();
  }
  convertToSpecifiedUnits(type: number) {
    if ($argumentCount() < 1) tooFew(1);
    const it = this.$impl.edit();
    const unit = angleUnit(type);
    Object.assign(it, { value: Math.fround(this.value / degreesIn[unit]), unit });
    this.$impl.commit();
  }
}
expose(SVGAngle, constants("SVG_ANGLETYPE_", "UNSPECIFIED DEG RAD GRAD"));

// ───────────────────────────── transforms ─────────────────────────────

const transformNames = ["", "matrix", "translate", "scale", "rotate", "skewX", "skewY"];
const argumentCounts = ["", "6", "12", "12", "13", "1", "1"];
const nextTransform = new RegExp(
  `${SPACE}(matrix|translate|scale|rotate|skewX|skewY)${SPACE}\\(([^)]*)\\)${SPACE},?`,
  "y",
);

function transformOf(type: number, [x, y, z, ...rest]: Numbers): Transform {
  const it = { type, angle: type >= 4 ? x : 0, center: [0, 0], m: [x, y, z, ...rest] };
  if (type === 2) it.m = [1, 0, 0, 1, x, y ?? 0];
  else if (type === 3) it.m = [x, 0, 0, y ?? x, 0, 0];
  else if (type === 4) {
    it.center = [y ?? 0, z ?? 0];
    it.m = multiply(multiply([1, 0, 0, 1, ...it.center], rotation(x)), [1, 0, 0, 1, -it.center[0], -it.center[1]]);
  } else if (type === 5) it.m = [1, 0, Math.tan(radians(x)), 1, 0, 0];
  else if (type === 6) it.m = [1, Math.tan(radians(x)), 0, 1, 0, 0];
  return it;
}

function parseTransforms(text: string): Transform[] | null {
  const items: Transform[] = [];
  let at = 0;
  for (let match; (nextTransform.lastIndex = at), (match = nextTransform.exec(text)) !== null;) {
    at = nextTransform.lastIndex;
    const type = transformNames.indexOf(match[1]);
    const values = parseNumbers(match[2]);
    if (values === null || !argumentCounts[type].includes("" + values.length)) return null;
    items.push(transformOf(type, values));
  }
  return splitTokens(text.slice(at)).length === 0 ? items : null;
}

function writeTransform({ type, angle, center, m }: Transform): string {
  let values = [angle];
  if (type === 1) values = m;
  else if (type === 2) values = [m[4], m[5]];
  else if (type === 3) values = [m[0], m[3]];
  else if (type === 4 && (center[0] !== 0 || center[1] !== 0)) values = [angle, ...center];
  return `${transformNames[type]}(${values.map(show).join(" ")})`;
}

class MatrixOfTransform extends Value<Numbers> {
  transform: Value<Transform>;

  constructor(transform: Value<Transform>) {
    super([], null);
    this.transform = transform;
  }
  read() {
    return this.transform.read().m;
  }
  edit() {
    return this.transform.edit().m;
  }
  commit() {
    Object.assign(this.transform.data, { type: 1, angle: 0 });
    this.transform.commit();
  }
}

const matrices = new WeakMap<object, object>();
function setTransform(self: SVGTransform, type: number, values: Numbers) {
  Object.assign(self.$impl.edit(), transformOf(type, values));
  self.$impl.commit();
}

class SVGTransform {
  declare $impl: Value<Transform>;

  constructor() {
    illegalConstructor();
  }
  get type() {
    return this.$impl.read().type;
  }
  get matrix() {
    let it = matrices.get(this.$impl);
    if (it === undefined) matrices.set(this.$impl, (it = make(SVGMatrix, new MatrixOfTransform(this.$impl)))!);
    return it;
  }
  get angle() {
    return this.$impl.read().angle;
  }
  setMatrix(init: any = undefined) {
    setTransform(this, 1, matrixFrom(init));
  }
  setTranslate(x: number, y: number) {
    setTransform(this, 2, [float(x), float(y)]);
  }
  setScale(x: number, y: number) {
    setTransform(this, 3, [float(x), float(y)]);
  }
  setRotate(angle: number, x: number, y: number) {
    setTransform(this, 4, [float(angle), float(x), float(y)]);
  }
  setSkewX(angle: number) {
    setTransform(this, 5, [float(angle)]);
  }
  setSkewY(angle: number) {
    setTransform(this, 6, [float(angle)]);
  }
}
expose(SVGTransform, constants("SVG_TRANSFORM_", "MATRIX TRANSLATE SCALE ROTATE SKEWX SKEWY"));
const transform = (init?: object) => make(SVGTransform, new Value(transformOf(1, matrixFrom(init)), null));

const alignments = splitTokens(
  "? none xMinYMin xMidYMin xMaxYMin xMinYMid xMidYMid xMaxYMid xMinYMax xMidYMax xMaxYMax",
);

function setRatio(self: SVGPreserveAspectRatio, index: number, value: number, count: number) {
  const it = self.$impl.edit();
  value &= 0xffff;
  if (value === 0 || value > count) throw domError("NotSupportedError", "The value provided is invalid.");
  it[index] = value;
  self.$impl.commit();
}

class SVGPreserveAspectRatio {
  declare $impl: Value<Numbers>;

  constructor() {
    illegalConstructor();
  }
  get align() {
    return this.$impl.read()[0];
  }
  set align(value) {
    setRatio(this, 0, value, 10);
  }
  get meetOrSlice() {
    return this.$impl.read()[1];
  }
  set meetOrSlice(value) {
    setRatio(this, 1, value, 2);
  }
}
expose(SVGPreserveAspectRatio, {
  ...constants("SVG_PRESERVEASPECTRATIO_", alignments.slice(1).join(" ").toUpperCase()),
  ...constants("SVG_MEETORSLICE_", "MEET SLICE"),
});

function parseRatio(text: string): Numbers | null {
  const [align, fit = "meet", extra] = splitTokens(text);
  const values = [alignments.indexOf(align), ["?", "meet", "slice"].indexOf(fit)];
  return extra === undefined && values[0] > 0 && values[1] > 0 ? values : null;
}

// ───────────────────────────── attributes ─────────────────────────────

/** How the text of an attribute becomes data, and back. */
type Syntax<T> = { parse(text: string): T | null; write(data: T): string; initial(): T };

class Attribute<T> implements Owner {
  node: N;
  name: string;
  /** It is the `animVal`. */
  isReadOnly: boolean;
  syntax: Syntax<T>;
  known: string | null | undefined = undefined;
  value: Value<T>;

  constructor(node: N, name: string, isAnimated: boolean, syntax: Syntax<T>) {
    this.node = node;
    this.name = name;
    this.isReadOnly = isAnimated;
    this.syntax = syntax;
    this.value = new Value(syntax.initial(), this);
  }
  key(): string {
    const { node, name } = this;
    return (name === "href" && !core.hasAttr(node, name) && core.findAttrNS(node, core.XLINK_NS, name)) || name;
  }
  refresh() {
    const { node } = this;
    const animated = this.isReadOnly ? layout(node)?.animatedAttribute(node.id, this.name) : null;
    const text = animated ?? getAttr(node, this.key());
    if (text === this.known) return;
    this.known = text;
    this.take((text === null ? null : this.syntax.parse(text)) ?? this.syntax.initial());
  }
  take(data: T) {
    this.value.data = data;
  }
  commit() {
    setAttr(this.node, this.key(), (this.known = this.syntax.write(this.value.data)));
    react();
  }
}

/** Without an interface for its items, they are strings. */
class List extends Attribute<any[]> {
  item: any;
  items: any[] = [];

  constructor(node: N, name: string, isAnimated: boolean, syntax: Syntax<any[]>, item: any) {
    super(node, name, isAnimated, syntax);
    this.item = item;
  }
  take(data: any[]) {
    if (this.item === null) return void (this.items = data);
    this.items.splice(data.length).forEach(release);
    data.forEach((it, i) => {
      if (i < this.items.length) this.items[i].$impl.data = it;
      else this.items.push(make(this.item, new Value(it, this)));
    });
  }
  commit() {
    this.value.data = this.item === null ? this.items : this.items.map(it => it.$impl.data);
    super.commit();
  }
  size() {
    this.refresh();
    return this.items.length;
  }
  at(index: number) {
    this.refresh();
    return this.items[index];
  }
  set(index: number, item: any) {
    this.splice(index, 1, item);
  }
  /** Gives what it has added, or else what it has removed. */
  splice(index: number, count: number, ...added: any[]) {
    if (added.length > 0) {
      if (this.item === null) added[0] = `${added[0]}`;
      else {
        const { item } = this;
        if (!(added[0] instanceof item)) throw new TypeError(`The item is not of type '${item.name}'.`);
      }
    }
    this.value.edit();
    if (count === 1) this.check(index);
    const ownItem = this.item;
    if (added.length > 0 && ownItem !== null) {
      const it: Value<any> = added[0].$impl;
      if (it.owner === null) it.owner = this;
      else added[0] = make(ownItem, new Value(structuredClone(it.read()), this));
      if (ownItem === SVGLength) added[0].$impl.data.axis = this.name.endsWith("x") ? 0 : 1;
    }
    const removed = this.items.splice(index, count, ...added);
    if (this.item !== null) removed.forEach(release);
    this.commit();
    return added[0] ?? removed[0];
  }
  check(index: number) {
    if (index >= this.size()) throw domError("IndexSizeError", `The index provided (${index}) is out of range.`);
  }
}

function release(item: any) {
  item.$impl.owner = null;
}

function listInterface(name: string): any {
  const ctor = {
    [name]: class {
      constructor() {
        illegalConstructor();
      }
      get length() {
        return this[kList].size();
      }
      get numberOfItems() {
        return this[kList].size();
      }
      clear() {
        this[kList].splice(0, Infinity);
      }
      initialize(item: any) {
        if ($argumentCount() < 1) tooFew(1);
        return this[kList].splice(0, Infinity, item);
      }
      getItem(index: number) {
        if ($argumentCount() < 1) tooFew(1);
        this[kList].check(index >>> 0);
        return this[kList].at(index >>> 0);
      }
      insertItemBefore(item: any, index: number) {
        if ($argumentCount() < 2) tooFew(2);
        return this[kList].splice(index >>> 0, 0, item);
      }
      replaceItem(item: any, index: number) {
        if ($argumentCount() < 2) tooFew(2);
        return this[kList].splice(index >>> 0, 1, item);
      }
      removeItem(index: number) {
        if ($argumentCount() < 1) tooFew(1);
        return this[kList].splice(index >>> 0, 1);
      }
      appendItem(item: any) {
        if ($argumentCount() < 1) tooFew(1);
        return this[kList].splice(Infinity, 0, item);
      }
    },
  }[name];
  iterable(ctor, false);
  return expose(ctor);
}
const SVGNumberList = listInterface("SVGNumberList");
const SVGLengthList = listInterface("SVGLengthList");
const SVGStringList = listInterface("SVGStringList");
const SVGPointList = listInterface("SVGPointList");
const SVGTransformList = listInterface("SVGTransformList");
core.mixin(
  {
    createSVGTransformFromMatrix(this: any, init: any = undefined) {
      this[kList].refresh();
      return transform(init);
    },
    consolidate(this: any) {
      const list: List = this[kList];
      list.value.edit();
      if (list.items.length === 0) return null;
      const product = list.items.map(it => it.$impl.data.m).reduce(multiply);
      return list.splice(0, Infinity, make(SVGTransform, new Value(transformOf(1, product), null)));
    },
  },
  SVGTransformList,
);

class Animated {
  base: Attribute<any>;
  animated: Attribute<any>;
  baseVal: any = null;
  animVal: any = null;
  /** Which of the values of the attribute it is about. */
  index = 0;
  keywords: string[] = [];

  constructor(attribute: (isAnimated: boolean) => Attribute<any>) {
    this.base = attribute(false);
    this.animated = attribute(true);
  }
}

function animatedInterface(name: string, convert?: (value: any, it: Animated) => unknown): any {
  const ctor = {
    [name]: class {
      constructor() {
        illegalConstructor();
      }
    },
  }[name];
  const objects: any = {
    get baseVal() {
      return this.$impl.baseVal;
    },
    get animVal() {
      return this.$impl.animVal;
    },
  };
  const primitives: any = {
    get baseVal() {
      return this.$impl.base.value.read()[this.$impl.index];
    },
    set baseVal(value) {
      const it: Animated = this.$impl;
      value = convert!(value, it);
      it.base.value.read()[it.index] = value;
      it.base.commit();
    },
    get animVal() {
      return this.$impl.animated.value.read()[this.$impl.index];
    },
  };
  core.mixin(convert ? primitives : objects, ctor);
  return expose(ctor);
}

const SVGAnimatedBoolean = animatedInterface("SVGAnimatedBoolean", value => !!value);
const SVGAnimatedInteger = animatedInterface("SVGAnimatedInteger", value => value | 0);
const SVGAnimatedNumber = animatedInterface("SVGAnimatedNumber", float);
const SVGAnimatedString = animatedInterface("SVGAnimatedString", (value, { base: { node, name } }) => {
  const check = node.name === "script" && name === "href" && node.doc.page?.trusted;
  return check ? check("scriptURL", value, "SVGScriptElement href") : `${value}`;
});
const SVGAnimatedEnumeration = animatedInterface("SVGAnimatedEnumeration", (value, { keywords }) => {
  value &= 0xffff;
  if (value === 0 || value >= keywords.length) throw new TypeError(`The enumeration value (${value}) is invalid.`);
  return value;
});
const [SVGAnimatedLength, SVGAnimatedAngle, SVGAnimatedRect, SVGAnimatedPreserveAspectRatio] = splitTokens(
  "Length Angle Rect PreserveAspectRatio",
).map(it => animatedInterface("SVGAnimated" + it));
const [SVGAnimatedNumberList, SVGAnimatedLengthList, SVGAnimatedTransformList] = splitTokens(
  "Number Length Transform",
).map(it => animatedInterface(`SVGAnimated${it}List`));

class SVGUnitTypes {
  constructor() {
    illegalConstructor();
  }
}
expose(SVGUnitTypes, constants("SVG_UNIT_TYPE_", "USERSPACEONUSE OBJECTBOUNDINGBOX"));

function primitive<T>(ctor: any, node: N, name: string, syntax: Syntax<T[]>, index = 0, keywords: string[] = []) {
  const it = new Animated(isAnimated => new Attribute(node, name, isAnimated, syntax));
  it.index = index;
  it.keywords = keywords;
  return make(ctor, it);
}

function object<T>(ctor: any, inner: any, node: N, name: string, syntax: Syntax<T>) {
  const it = new Animated(isAnimated => new Attribute(node, name, isAnimated, syntax));
  it.baseVal = make(inner, it.base.value);
  it.animVal = make(inner, it.animated.value);
  return make(ctor, it);
}

function listSyntax<T>(parse: (text: string) => T[] | null, write: (it: T) => string, glue = " "): Syntax<T[]> {
  return { parse, write: items => items.map(write).join(glue), initial: () => [] };
}

function list(ctor: any, inner: any, item: any, node: N, name: string, syntax: Syntax<any[]>) {
  const it = new Animated(isAnimated => new List(node, name, isAnimated, syntax, item));
  it.baseVal = makeList(inner, it.base as List);
  it.animVal = makeList(inner, it.animated as List);
  return make(ctor, it);
}

const enumerations = {
  units: "userSpaceOnUse objectBoundingBox",
  lengthAdjust: "spacing spacingAndGlyphs",
  method: "align stretch",
  spacing: "auto exact",
  side: "left right",
  markerUnits: "userSpaceOnUse strokeWidth",
  spreadMethod: "pad reflect repeat",
  mode: `normal multiply screen darken lighten overlay color-dodge color-burn hard-light soft-light difference
    exclusion hue saturation color luminosity`,
  colorMatrix: "matrix saturate hueRotate luminanceToAlpha",
  transfer: "identity table discrete linear gamma",
  composite: "over in out atop xor arithmetic",
  edgeMode: "duplicate wrap none",
  channel: "R G B A",
  morphology: "erode dilate",
  stitchTiles: "stitch noStitch",
  turbulence: "fractalNoise turbulence",
};

function parseIntegers(text: string): Numbers | null {
  const words = text.trim().split(/\s*,\s*|\s+/);
  return words.every(it => /^[+-]?\d+$/.test(it) && (+it | 0) === +it) ? words.map(Number) : null;
}

function numbers(node: N, property: string, isInteger: boolean, initial: number) {
  const pair = /^(baseFrequency|kernelUnitLength|order|radius|stdDeviation)([XY])$/.exec(property);
  const parse = (text: string) => {
    const percentage = property === "offset" && text.trimEnd().endsWith("%");
    if (percentage) return parseNumbers(text.trimEnd().slice(0, -1))?.map(it => Math.fround(it / 100)) ?? null;
    const values = /,\s*$/.test(text) ? null : isInteger ? parseIntegers(text) : parseNumbers(text);
    if (values === null || values.length === 0 || values.length > (pair ? 2 : 1)) return null;
    if (pair?.[1] === "order" && values.some(it => it <= 0)) return null;
    return pair ? [values[0], values.at(-1)!] : values;
  };
  const write = (values: Numbers) =>
    (values[0] === values[1] ? [values[0]] : values).map(isInteger ? String : show).join(" ");
  const syntax = { parse, write, initial: () => (pair ? [initial, initial] : [initial]) };
  const ctor = isInteger ? SVGAnimatedInteger : SVGAnimatedNumber;
  return primitive(ctor, node, pair?.[1] ?? property, syntax, pair?.[2] === "Y" ? 1 : 0);
}

const orientations = ["", "auto", "0", "auto-start-reverse"];
const axisOf = (name: string) =>
  /^(?:[cfdr]?x\d?|refX|width|markerWidth)$/.test(name)
    ? 0
    : /^(?:[cfdr]?y\d?|refY|height|markerHeight)$/.test(name)
      ? 1
      : 2;

/**
 * After the name: `=` and the initial value for a length, `#` for a number, `!` for an integer, `:` and the name for an
 * enumeration, `$` for a string, and `*` for a list.
 */
function reflect(node: N, description: string) {
  const [, name, kind, rest] = /^(\w+)(\W?)(.*)$/.exec(description)!;
  if (kind === "#" || kind === "!") return numbers(node, name, kind === "!", +rest);
  if (kind === "$") {
    return primitive(SVGAnimatedString, node, rest || name, {
      parse: it => [it],
      write: it => it[0],
      initial: () => [""],
    });
  }
  if (kind === ":") {
    const [, enumeration, initial] = /^(\D*)(\d)$/.exec(rest)!;
    const keywords = ["", ...splitTokens(enumerations[enumeration || name])];
    const parse = (text: string) => (keywords.indexOf(text) > 0 ? [keywords.indexOf(text)] : null);
    const syntax = { parse, write: (it: Numbers) => keywords[it[0]], initial: () => [+initial] };
    return primitive(SVGAnimatedEnumeration, node, name, syntax, 0, keywords);
  }
  if (kind === "*" && rest === "#") {
    const syntax = listSyntax(
      text => parseNumbers(text)?.map(it => [it]) ?? null,
      it => show(it[0]),
    );
    return list(SVGAnimatedNumberList, SVGNumberList, SVGNumber, node, name, syntax);
  }
  if (kind === "*") {
    const parse = (text: string) => {
      const items = (text.match(/[^\s,(]+(?:\(.*?\)+)?/g) ?? []).map(it => parseLength(it, axisOf(name)));
      return items.includes(null) ? null : (items as Length[]);
    };
    return list(SVGAnimatedLengthList, SVGLengthList, SVGLength, node, name, listSyntax(parse, writeLength));
  }
  switch (name) {
    case "transform":
    case "gradientTransform":
    case "patternTransform": {
      const syntax = listSyntax(parseTransforms, writeTransform);
      return list(SVGAnimatedTransformList, SVGTransformList, SVGTransform, node, name, syntax);
    }
    case "points":
    case "animatedPoints": {
      const parse = (text: string) => {
        const values = parseNumbers(text);
        return values && Array.from({ length: values.length >> 1 }, (_, i) => values.slice(i * 2, i * 2 + 2));
      };
      const syntax = listSyntax(parse, it => it.map(show).join(","));
      return makeList(SVGPointList, new List(node, "points", name !== "points", syntax, SVGPoint));
    }
    case "requiredExtensions":
      return makeList(SVGStringList, new List(node, name, false, listSyntax(splitTokens, String), null));
    case "systemLanguage": {
      const parse = (text: string) => (text.trim() === "" ? [] : text.split(",").map(it => it.trim()));
      return makeList(SVGStringList, new List(node, name, false, listSyntax(parse, String, ","), null));
    }
    case "viewBox":
      return object(SVGAnimatedRect, SVGRect, node, name, {
        parse(text) {
          const values = parseNumbers(text);
          return values?.length === 4 && values[2] >= 0 && values[3] >= 0 ? values : null;
        },
        write: (it: Numbers) => it.map(show).join(" "),
        initial: () => [0, 0, 0, 0],
      });
    case "preserveAspectRatio":
      return object(SVGAnimatedPreserveAspectRatio, SVGPreserveAspectRatio, node, name, {
        parse: parseRatio,
        write: it => alignments[it[0]] + (it[1] === 2 ? " slice" : " meet"),
        initial: () => [6, 1],
      });
    case "preserveAlpha":
      return primitive(SVGAnimatedBoolean, node, name, {
        parse: it => [it === "true"],
        write: it => `${it[0]}`,
        initial: () => [false],
      });
    case "orientAngle":
      return object(SVGAnimatedAngle, SVGAngle, node, "orient", {
        parse: parseAngle,
        write: it => show(it.value) + it.unit,
        initial: () => ({ value: 0, unit: "" }),
      });
    case "orientType": {
      const parse = (text: string) => [Math.max(orientations.indexOf(text), 0) || 2];
      const write = (it: Numbers) =>
        it[0] === 2 && parseAngle(getAttr(node, "orient") ?? "") ? getAttr(node, "orient")! : orientations[it[0]];
      return primitive(SVGAnimatedEnumeration, node, "orient", { parse, write, initial: () => [2] }, 0, orientations);
    }
  }
  const axis = axisOf(name);
  return object(SVGAnimatedLength, SVGLength, node, name, {
    parse: text => parseLength(text, axis),
    write: writeLength,
    initial: () => parseLength(rest || "0", axis)!,
  });
}

export default {
  SVGAngle,
  SVGRect,
  Value,
  angle: () => make(SVGAngle, new Value({ value: 0, unit: "" }, null)),
  constants,
  float,
  length: () => make(SVGLength, new Value({ value: 0, unit: "", axis: 2 }, null)),
  matrix,
  number: () => make(SVGNumber, new Value([0], null)),
  ownedPoint: (owner: Owner) => make(SVGPoint, new Value([0, 0], owner)),
  point,
  rect,
  reflect,
  transform,
};
