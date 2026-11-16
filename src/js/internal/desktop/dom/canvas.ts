// Canvas 2D. The state that scripts can read is here, and packages/bun-desktop/src/canvas.rs draws.
const nativeDraw = $bindgen("desktop.bind.ts", "draw");
const nativeMeasure = $bindgen("desktop.bind.ts", "measure");

type Native = {
  send(command: string, argument: object): void;
  ask(command: string, argument: object): any;
  request(command: string, argument: object): Promise<any>;
  putBlob(bytes: Uint8Array): number;
  takeBlob(id: number): Buffer;
};

/** internal/desktop/native, which only the main realm may load. */
let native: Native;
const engine = require("internal/desktop/dom/engine");
const core = require("internal/desktop/dom/core");
const events = require("internal/desktop/dom/events");
const { DOMMatrix, fixMatrix } = require("internal/desktop/dom/geometry");

/** On anything that `drawImage` takes: an id of `image.decode` or of a canvas, or 0 while there are no pixels. */
const kImageId = Symbol("imageId");
/** On the same objects: `[width, height]` of the pixels. */
const kImageSize = Symbol("imageSize");
/** On the same objects, and on patterns: whether it has pixels of an origin that scripts may not read. */
const kIsTainted = Symbol("isTainted");
/** On a context: `(width, height)`, which clears it. */
const kResize = Symbol("resize");
/** On a context: `(type, quality)`, to a `Buffer`, or to null if it has no pixels. */
const kEncodeSync = Symbol("encodeSync");
/** The same, as a promise. */
const kEncode = Symbol("encode");
const kAdopt = Symbol("adopt");
const kErase = Symbol("erase");
const kInternal = Symbol("internal");

type Host = {
  width: number;
  height: number;
  invalidate?(): void;
  /** What scripts see, if that is another object. */
  canvas?: Host;
};

const hooks = {
  isFocused: (_canvas: Host, _element: unknown) => false,
  useFont(_canvas: Host, _font: Font) {},
  /** What `em`, `%`, `rem`, `inherit` and `currentcolor` refer to, and the `scope` of `font.register`. */
  inherited: (_canvas: Host) => ({
    fontSize: 10,
    rootFontSize: 16,
    direction: "ltr",
    color: "#000",
    language: "",
    fontScope: 0,
  }),
};

const enum Op {
  Select,
  Save,
  Restore,
  Transform,
  FillStyle,
  StrokeStyle,
  Alpha,
  Composite,
  Line,
  Shadow,
  Smoothing,
  Filter,
  Clip,
  Fill,
  Stroke,
  FillRect,
  StrokeRect,
  ClearRect,
  FillText,
  StrokeText,
  DrawImage,
}

const enum Verb {
  Move,
  Line,
  Quad,
  Cubic,
  Close,
}

const { isFinite } = Number;
const { abs, atan2, ceil, cos, hypot, max, min, sin, sqrt, tan, PI } = Math;
const TAU = PI * 2;

function allFinite(a: number, b: number, c = 0, d = 0, e = 0, f = 0, g = 0) {
  // NaN if any of them is NaN or infinite.
  return a * 0 + b * 0 + c * 0 + d * 0 + e * 0 + f * 0 + g * 0 === 0;
}

function indexSizeError(message: string) {
  return new DOMException(message, "IndexSizeError");
}

function invalidStateError(message: string) {
  return new DOMException(message, "InvalidStateError");
}

function need(given: number, wanted: number) {
  if (given < wanted) throw new TypeError(`${wanted} arguments required, but only ${given} present.`);
}

/** `[EnforceRange]` */
function enforce(value: unknown, least = -(2 ** 31), most = 2 ** 31 - 1): number {
  const number = Math.trunc(+value!);
  if (!(number >= least && number <= most)) throw new TypeError("Value is outside the range of the type.");
  return number + 0;
}

function dictionary(value: any): any {
  if (value != null && !$isObject(value)) throw new TypeError("The provided value is not a dictionary.");
  return value ?? {};
}

function oneOf(value: unknown, allowed: string): string {
  const text = value === undefined ? allowed.split(" ")[0] : `${value}`;
  if (!allowed.split(" ").includes(text))
    throw new TypeError(`The provided value '${text}' is not a valid enum value.`);
  return text;
}

function requireClean(source: object) {
  if (source[kIsTainted]) throw new DOMException("The canvas has been tainted by cross-origin data.", "SecurityError");
}

function checkInternal(key: unknown) {
  if (key !== kInternal) throw new TypeError("Illegal constructor");
}

class Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;

  constructor(a: number, b: number, c: number, d: number, e: number, f: number) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }

  isFinite() {
    return allFinite(this.a, this.b, this.c, this.d, this.e, this.f);
  }
}

const identity = new Matrix(1, 0, 0, 1, 0, 0);

// One stream for every canvas, because one can be drawn on another.
class Stream {
  numbers = new Float64Array(64);
  length = 0;

  /** Returns where they go. */
  #add(count: number): number {
    const at = this.length;
    const length = (this.length = (at + count) | 0);
    if (length > this.numbers.length) {
      const larger = new Float64Array(length * 2);
      larger.set(this.numbers);
      this.numbers = larger;
    }
    return at;
  }

  push(value: number) {
    const at = this.#add(1);
    this.numbers[at] = value;
  }

  push2(a: number, b: number) {
    const at = this.#add(2);
    const { numbers } = this;
    numbers[at] = a;
    numbers[at + 1] = b;
  }

  push4(a: number, b: number, c: number, d: number) {
    const at = this.#add(4);
    const { numbers } = this;
    numbers[at] = a;
    numbers[at + 1] = b;
    numbers[at + 2] = c;
    numbers[at + 3] = d;
  }

  pushAll(values: number[]) {
    const at = this.#add(values.length);
    const { numbers } = this;
    for (let i = 0; i < values.length; i++) numbers[at + i] = values[i];
  }

  pushMatrix({ a, b, c, d, e, f }: Matrix) {
    this.push4(a, b, c, d);
    this.push2(e, f);
  }

  pushPath(segments: Stream, { a, b, c, d, e, f }: Matrix) {
    const count = segments.length;
    let at = this.#add(count + 1);
    const from = segments.numbers;
    const to = this.numbers;
    to[at++] = count;
    for (let i = 0; i < count;) {
      const verb = (to[at++] = from[i++]);
      for (let end = i + (coordinates[verb] | 0); i < end; i += 2) {
        const x = from[i];
        const y = from[i + 1];
        to[at++] = a * x + c * y + e;
        to[at++] = b * x + d * y + f;
      }
    }
  }

  take(): number {
    const blob = native.putBlob(new Uint8Array(this.numbers.buffer, 0, this.length * 8));
    this.length = 0;
    return blob;
  }
}

const coordinates = new Uint8Array([2, 2, 4, 6, 0]);
const stream = new Stream();
/** Each followed by U+0000. */
let texts = "";
const measured = new Float64Array(12);
let selected = 0;
let isFlushQueued = false;
let flushes = 0;
let changed: Host[] = [];

function flush() {
  isFlushQueued = false;
  flushes++;
  if (stream.length === 0) return;
  nativeDraw(stream.numbers, stream.length, texts);
  stream.length = selected = 0;
  texts = "";
  const canvases = changed;
  changed = [];
  for (const canvas of canvases) canvas.invalidate?.();
}

function queueFlush() {
  if (isFlushQueued) return;
  isFlushQueued = true;
  queueMicrotask(flush);
}

function release(command: string, id: number) {
  flush();
  native.send(command, { id });
}

const canvases = new FinalizationRegistry<number>(id => release("canvas.release", id));
const bitmaps = new FinalizationRegistry<number>(id => release("image.release", id));

// ───────────────────────────── values ─────────────────────────────

const colors = new Map<string, number>();

/** 0xRRGGBBAA, or -1. */
function parseColor(text: string): number {
  const known = colors.$get(text);
  if (known !== undefined) return +known;
  const color = +engine.parseColor(text, 0xff);
  if (colors.$size > 1024) colors.clear();
  colors.$set(text, color);
  return color;
}

function serializeColor(color: number) {
  const alpha = color & 255;
  if (alpha === 255) return "#" + (color >>> 8).toString(16).padStart(6, "0");
  let fraction = Math.round(alpha / 2.55) / 100;
  if (Math.round(fraction * 255) !== alpha) fraction = Math.round(alpha / 0.255) / 1000;
  return `rgba(${color >>> 24}, ${(color >>> 16) & 255}, ${(color >>> 8) & 255}, ${fraction})`;
}

const absoluteUnits = {
  __proto__: null,
  px: 1,
  pt: 4 / 3,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};
const relativeUnits = { __proto__: null, em: 1, ex: 0.5, ch: 0.5, ic: 1, cap: 0.7, lh: 1.2 };
const dimension = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/;

/** In pixels, or NaN. */
function parseLength(text: string, em: number, rem: number): number {
  const match = dimension.exec(text.toLowerCase());
  if (!match) return NaN;
  const [, number, unit] = match;
  if (unit === "") return +number === 0 ? 0 : NaN;
  const isOfRoot = unit[0] === "r";
  return +number * (absoluteUnits[unit] ?? relativeUnits[isOfRoot ? unit.slice(1) : unit] * (isOfRoot ? rem : em));
}

const fontSizes = {
  __proto__: null,
  "xx-small": 9,
  "x-small": 10,
  small: 13,
  medium: 16,
  large: 18,
  "x-large": 24,
  "xx-large": 32,
  "xxx-large": 48,
};
const fontStretches = {
  __proto__: null,
  "ultra-condensed": 50,
  "extra-condensed": 62.5,
  condensed: 75,
  "semi-condensed": 87.5,
  normal: 100,
  "semi-expanded": 112.5,
  expanded: 125,
  "extra-expanded": 150,
  "ultra-expanded": 200,
};
const fontWeights = { __proto__: null, bold: 700, bolder: 700, lighter: 100 };
const capsFeatures = {
  __proto__: null,
  normal: [],
  "small-caps": ["smcp"],
  "all-small-caps": ["smcp", "c2sc"],
  "petite-caps": ["pcap"],
  "all-petite-caps": ["pcap", "c2pc"],
  unicase: ["unic"],
  "titling-caps": ["titl"],
};
const genericFamily =
  /^(?:serif|sans-serif|monospace|cursive|fantasy|system-ui|math|emoji|fangsong|ui-(?:serif|sans-serif|monospace|rounded))$/;
const fontToken = /\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[,/]|[^\s,/"']+)/gy;
const reservedFamily = /^(?:default|inherit|initial|revert|revert-layer|unset)$/i;
const systemFont = /^(?:caption|icon|menu|message-box|small-caption|status-bar)$/i;
const identifier = /^-?[a-zA-Z_\u0080-￿][\w\u0080-￿-]*$/;

type Font = {
  text: string;
  size: number;
  weight: number;
  style: number;
  stretch: string;
  caps: string;
  families: [name: string, isGeneric: boolean][];
};

const isPlainFamily = (name: string) =>
  identifier.test(name) && !genericFamily.test(name) && !reservedFamily.test(name);

function parseFont(text: string, em: number, rem: number): Font | undefined {
  if (systemFont.test(text.trim())) text = "16px system-ui";
  const tokens = Array.from(text.trim().matchAll(fontToken), match => match[1]);
  const font: Font = { text: "", size: NaN, weight: 400, style: 0, stretch: "normal", caps: "normal", families: [] };
  let i = 0;
  for (; i < tokens.length; i++) {
    const token = tokens[i].toLowerCase();
    if (token === "normal") continue;
    if (token === "italic") font.style = 1;
    else if (token === "oblique") font.style = 2;
    else if (token === "small-caps") font.caps = token;
    else if (token in fontWeights) font.weight = fontWeights[token];
    else if (token in fontStretches) font.stretch = token;
    else if (+token >= 1 && +token <= 1000) font.weight = +token;
    else if (font.style !== 2 || !token.endsWith("deg")) break;
  }
  const size = tokens[i++]?.toLowerCase() ?? "";
  if (size in fontSizes) font.size = fontSizes[size];
  else if (size === "larger") font.size = em * 1.2;
  else if (size === "smaller") font.size = em / 1.2;
  else font.size = size.endsWith("%") ? (parseFloat(size) * em) / 100 : parseLength(size, em, rem);
  if (!(font.size >= 0)) return;
  if (tokens[i] === "/") i += 2;
  for (; i < tokens.length; i++) {
    const quote = tokens[i][0];
    if (quote === '"' || quote === "'") {
      font.families.push([tokens[i++].slice(1, -1).replace(/\\(.)/g, "$1"), false]);
    } else {
      const words: string[] = [];
      while (i < tokens.length && identifier.test(tokens[i])) words.push(tokens[i++]);
      if (words.length === 0) return;
      const name = words.join(" ");
      if (reservedFamily.test(name)) return;
      const isGeneric = genericFamily.test(name.toLowerCase());
      font.families.push([isGeneric ? name.toLowerCase() : name, isGeneric]);
    }
    if (i < tokens.length && (tokens[i] !== "," || i === tokens.length - 1)) return;
  }
  if (font.families.length === 0) return;
  const parts: string[] = [];
  if (font.style) parts.push("italic");
  if (font.weight !== 400) parts.push(font.weight === 700 ? "bold" : String(font.weight));
  if (font.caps !== "normal") parts.push(font.caps);
  parts.push(+font.size.toPrecision(6) + "px");
  parts.push(
    font.families
      .map(([name, isGeneric]) => (isGeneric || isPlainFamily(name) ? name : JSON.stringify(name)))
      .join(", "),
  );
  font.text = parts.join(" ");
  return font;
}

const filterNames = [
  "blur",
  "brightness",
  "contrast",
  "grayscale",
  "hue-rotate",
  "invert",
  "opacity",
  "saturate",
  "sepia",
];
const filterFunction = /\s*([a-z-]+)\(((?:[^()]|\([^()]*\))*)\)/giy;
const filterArgument = /[^\s(]+(?:\([^()]*\))?/g;
const angleUnits = { __proto__: null, deg: 1, grad: 0.9, rad: 180 / PI, turn: 360 };

/** The operands of `Op.Filter`. */
function parseFilter(text: string, em: number, rem: number): number[] | undefined {
  if (text === "none") return [0];
  const operands = [0];
  let consumed = 0;
  for (const [all, name, argument] of text.matchAll(filterFunction)) {
    consumed += all.length;
    operands[0]++;
    const kind = filterNames.indexOf(name.toLowerCase());
    const value = argument.trim().toLowerCase();
    if (name.toLowerCase() === "drop-shadow") {
      const lengths: number[] = [];
      let color = 255;
      for (const [part] of value.matchAll(filterArgument)) {
        const length = parseLength(part, em, rem);
        if (length === length) lengths.push(length);
        else if ((color = parseColor(part)) < 0) return;
      }
      if (lengths.length < 2 || lengths.length > 3 || lengths[2] < 0) return;
      operands.push(9, lengths[2] ?? 0, lengths[0], lengths[1], color);
      continue;
    }
    const [, number, unit] = dimension.exec(value) ?? [];
    let amount: number;
    if (kind < 0) return;
    if (value === "") amount = kind === 0 || kind === 4 ? 0 : 1;
    else if (kind === 0) amount = parseLength(value, em, rem);
    else if (kind === 4) amount = +number * (angleUnits[unit] ?? (+number === 0 ? 0 : NaN));
    else amount = unit === "%" ? +number / 100 : unit === "" ? +number : NaN;
    if (amount !== amount || (amount < 0 && kind !== 4)) return;
    operands.push(kind, amount);
  }
  return consumed === text.length && consumed > 0 ? operands : undefined;
}

function matrixFrom(init: unknown): Matrix {
  const m = fixMatrix(init, true);
  return new Matrix(m[0], m[1], m[4], m[5], m[12], m[13]);
}

// ───────────────────────────── paths ─────────────────────────────

/** `segments` has the points after `matrix`, which may change from one call to the next. */
class PathBuilder {
  segments = new Stream();
  matrix = identity;
  isEmpty = true;
  #x = 0;
  #y = 0;
  #startX = 0;
  #startY = 0;

  clear() {
    this.segments.length = 0;
    this.isEmpty = true;
  }

  #point(x: number, y: number) {
    const { a, b, c, d, e, f } = this.matrix;
    this.segments.push2((this.#x = a * x + c * y + e), (this.#y = b * x + d * y + f));
  }

  #ensure(x: number, y: number) {
    if (this.isEmpty) this.moveTo(x, y);
  }

  append(path: PathBuilder, matrix: Matrix) {
    const segments = path.segments.numbers.slice(0, path.segments.length);
    const saved = this.matrix;
    this.matrix = matrix;
    for (let i = 0; i < segments.length;) {
      const verb = segments[i++];
      if (verb === Verb.Move) this.moveTo(segments[i], segments[i + 1]);
      else if (verb === Verb.Close) this.closePath();
      else {
        this.segments.push(verb);
        for (let at = i; at < i + coordinates[verb]; at += 2) this.#point(segments[at], segments[at + 1]);
      }
      i += coordinates[verb];
    }
    this.matrix = saved;
  }

  closePath() {
    if (this.isEmpty) return;
    this.segments.push4(Verb.Close, Verb.Move, (this.#x = this.#startX), (this.#y = this.#startY));
  }

  moveTo(x: number, y: number) {
    if (!allFinite(x, y)) return;
    this.segments.push(Verb.Move);
    this.#point(x, y);
    this.#startX = this.#x;
    this.#startY = this.#y;
    this.isEmpty = false;
  }

  lineTo(x: number, y: number) {
    if (!allFinite(x, y)) return;
    if (this.isEmpty) return this.moveTo(x, y);
    this.segments.push(Verb.Line);
    this.#point(x, y);
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    if (!allFinite(cx, cy, x, y)) return;
    this.#ensure(cx, cy);
    this.segments.push(Verb.Quad);
    this.#point(cx, cy);
    this.#point(x, y);
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    if (!allFinite(c1x, c1y, c2x, c2y, x, y)) return;
    this.#ensure(c1x, c1y);
    this.segments.push(Verb.Cubic);
    this.#point(c1x, c1y);
    this.#point(c2x, c2y);
    this.#point(x, y);
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
    if (!allFinite(x1, y1, x2, y2, radius)) return;
    if (radius < 0) throw indexSizeError(`The radius provided (${radius}) is negative.`);
    this.#ensure(x1, y1);
    const { a, b, c, d, e, f } = this.matrix;
    const determinant = a * d - b * c;
    const ax = (d * (this.#x - e) - c * (this.#y - f)) / determinant - x1;
    const ay = (a * (this.#y - f) - b * (this.#x - e)) / determinant - y1;
    const bx = x2 - x1;
    const by = y2 - y1;
    const lengthA = hypot(ax, ay);
    const lengthB = hypot(bx, by);
    const cross = ax * by - ay * bx;
    if (radius === 0 || !(abs(cross) > 1e-9 * lengthA * lengthB)) return this.lineTo(x1, y1);
    const distance = radius / abs(tan(atan2(cross, ax * bx + ay * by) / 2));
    const side = cross < 0 ? radius : -radius;
    const startX = x1 + (ax / lengthA) * distance;
    const startY = y1 + (ay / lengthA) * distance;
    const centerX = startX + (ay / lengthA) * side;
    const centerY = startY - (ax / lengthA) * side;
    const from = atan2(startY - centerY, startX - centerX);
    const to = atan2(y1 + (by / lengthB) * distance - centerY, x1 + (bx / lengthB) * distance - centerX);
    this.ellipse(centerX, centerY, radius, radius, 0, from, to, cross > 0);
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    from: number,
    to: number,
    counterclockwise: boolean,
  ) {
    if (!allFinite(x, y, radiusX, radiusY, rotation, from, to)) return;
    if (radiusX < 0 || radiusY < 0) throw indexSizeError(`The radius provided (${min(radiusX, radiusY)}) is negative.`);
    let sweep = counterclockwise ? from - to : to - from;
    if (sweep >= TAU) sweep = TAU;
    else if (sweep < 0) sweep = TAU - (-sweep % TAU);
    if (counterclockwise) sweep = -sweep;
    const a = radiusX * cos(rotation);
    const b = radiusX * sin(rotation);
    const c = -radiusY * sin(rotation);
    const d = radiusY * cos(rotation);
    let u = cos(from);
    let v = sin(from);
    this.lineTo(x + a * u + c * v, y + b * u + d * v);
    const count = ceil(abs(sweep) / (PI / 2));
    const k = (4 / 3) * tan(sweep / count / 4);
    for (let i = 1; i <= count; i++) {
      const u1 = u - k * v;
      const v1 = v + k * u;
      u = cos(from + (sweep * i) / count);
      v = sin(from + (sweep * i) / count);
      const u2 = u + k * v;
      const v2 = v - k * u;
      this.bezierCurveTo(
        x + a * u1 + c * v1,
        y + b * u1 + d * v1,
        x + a * u2 + c * v2,
        y + b * u2 + d * v2,
        x + a * u + c * v,
        y + b * u + d * v,
      );
    }
  }

  rect(x: number, y: number, width: number, height: number) {
    if (!allFinite(x, y, width, height)) return;
    this.moveTo(x, y);
    this.lineTo(x + width, y);
    this.lineTo(x + width, y + height);
    this.lineTo(x, y + height);
    this.closePath();
  }

  roundRect(x: number, y: number, width: number, height: number, radii: any) {
    if (!allFinite(x, y, width, height)) return;
    const list = typeof radii === "object" && radii !== null && Symbol.iterator in radii ? [...radii] : [radii ?? 0];
    if (list.length < 1 || list.length > 4) {
      throw new RangeError(`${list.length} radii provided. Between one and four radii are necessary.`);
    }
    const pairs = list.map(radius =>
      typeof radius === "object" && radius !== null ? [+(radius.x ?? 0), +(radius.y ?? 0)] : [+radius, +radius],
    );
    for (const [radiusX, radiusY] of pairs) {
      if (!allFinite(radiusX, radiusY)) return;
      if (radiusX < 0 || radiusY < 0) throw new RangeError(`Radius value ${min(radiusX, radiusY)} is negative.`);
    }
    const [tl, tr = tl, br = tl, bl = tr] = pairs;
    const w = abs(width);
    const h = abs(height);
    const scale = min(1, w / (tl[0] + tr[0]), h / (tr[1] + br[1]), w / (br[0] + bl[0]), h / (tl[1] + bl[1])) || 0;
    const sx = width < 0 ? -scale : scale;
    const sy = height < 0 ? -scale : scale;
    const corner = (cornerX, cornerY, fromX, fromY, toX, toY) => {
      const k = 1 - 0.5522847498;
      this.lineTo(cornerX + fromX, cornerY + fromY);
      this.bezierCurveTo(
        cornerX + fromX * k,
        cornerY + fromY * k,
        cornerX + toX * k,
        cornerY + toY * k,
        cornerX + toX,
        cornerY + toY,
      );
    };
    this.moveTo(x + tl[0] * sx, y);
    corner(x + width, y, -tr[0] * sx, 0, 0, tr[1] * sy);
    corner(x + width, y + height, 0, -br[1] * sy, -br[0] * sx, 0);
    corner(x, y + height, bl[0] * sx, 0, 0, -bl[1] * sy);
    corner(x, y, 0, tl[1] * sy, tl[0] * sx, 0);
    this.closePath();
    this.moveTo(x, y);
  }

  /** https://www.w3.org/TR/SVG2/implnote.html#ArcConversionEndpointToCenter */
  #svgArc(x0, y0, radiusX, radiusY, degrees, isLarge, isClockwise, x, y) {
    if (x0 === x && y0 === y) return;
    radiusX = abs(radiusX);
    radiusY = abs(radiusY);
    if (radiusX === 0 || radiusY === 0) return this.lineTo(x, y);
    const rotation = (degrees * PI) / 180;
    const cosine = cos(rotation);
    const sine = sin(rotation);
    const px = (cosine * (x0 - x) + sine * (y0 - y)) / 2;
    const py = (cosine * (y0 - y) - sine * (x0 - x)) / 2;
    const excess = (px / radiusX) ** 2 + (py / radiusY) ** 2;
    if (excess > 1) {
      radiusX *= sqrt(excess);
      radiusY *= sqrt(excess);
    }
    const factor = (isLarge === isClockwise ? -1 : 1) * sqrt(max(0, 1 / min(excess, 1) - 1));
    const cx = (factor * radiusX * py) / radiusY;
    const cy = (-factor * radiusY * px) / radiusX;
    this.ellipse(
      cosine * cx - sine * cy + (x0 + x) / 2,
      sine * cx + cosine * cy + (y0 + y) / 2,
      radiusX,
      radiusY,
      rotation,
      atan2((py - cy) / radiusY, (px - cx) / radiusX),
      atan2((-py - cy) / radiusY, (-px - cx) / radiusX),
      !isClockwise,
    );
  }

  /** Up to the first error. */
  appendSvg(data: string) {
    let at = 0;
    const read = (pattern: RegExp) => {
      pattern.lastIndex = at;
      const match = pattern.exec(data);
      if (match) at = pattern.lastIndex;
      return match?.[1];
    };
    let x = 0;
    let y = 0;
    let startX = 0;
    let startY = 0;
    let controlX = 0;
    let controlY = 0;
    let previous = "";
    let command: string | undefined;
    while (true) {
      command = read(svgCommand) ?? (command === "M" ? "L" : command === "m" ? "l" : command);
      if (command === undefined) return;
      const kind = command.toUpperCase();
      if (previous === "" && kind !== "M") return;
      const values: number[] = [];
      for (let i = 0; i < svgOperands[kind]; i++) {
        const value = read(kind === "A" && (i === 3 || i === 4) ? svgFlag : svgNumber);
        if (value === undefined) return;
        values.push(+value);
      }
      if (kind === "H") values.push(command === kind ? y : 0);
      if (kind === "V") values.unshift(command === kind ? x : 0);
      if (command !== kind) {
        for (let i = kind === "A" ? 5 : 0; i < values.length; i += 2) {
          values[i] += x;
          values[i + 1] += y;
        }
      }
      if (kind === "S" || kind === "T") {
        const reflects = kind === "S" ? previous === "C" || previous === "S" : previous === "Q" || previous === "T";
        values.unshift(reflects ? 2 * x - controlX : x, reflects ? 2 * y - controlY : y);
      }
      const [a, b, c, d, e, f, g] = values;
      if (kind === "M") this.moveTo((startX = a), (startY = b));
      else if (kind === "C" || kind === "S") this.bezierCurveTo(a, b, (controlX = c), (controlY = d), e, f);
      else if (kind === "Q" || kind === "T") this.quadraticCurveTo((controlX = a), (controlY = b), c, d);
      else if (kind === "A") this.#svgArc(x, y, a, b, c, d === 1, e === 1, f, g);
      else if (kind === "Z") this.closePath();
      else this.lineTo(a, b);
      x = kind === "Z" ? startX : values.at(-2)!;
      y = kind === "Z" ? startY : values.at(-1)!;
      previous = kind;
      if (kind === "Z") command = undefined;
    }
  }
}

const svgCommand = /\s*([MZLHVCSQTA])/iy;
const svgNumber = /\s*,?\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)/iy;
const svgFlag = /\s*,?\s*([01])/y;
const svgOperands = { M: 2, Z: 0, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 };

let segmentsOf: (path: Path2D) => Stream;

class Path2D {
  #path = new PathBuilder();

  static {
    segmentsOf = path => path.#path.segments;
  }

  constructor(path: Path2D | string | undefined = undefined) {
    if (path instanceof Path2D) this.#path.append(path.#path, identity);
    else if (path !== undefined) this.#path.appendSvg(String(path));
  }

  addPath(path: Path2D, transform: unknown = undefined) {
    if (!(path instanceof Path2D)) throw new TypeError("parameter 1 is not of type 'Path2D'.");
    const matrix = matrixFrom(transform);
    if (matrix.isFinite()) this.#path.append(path.#path, matrix);
  }

  closePath() {
    this.#path.closePath();
  }

  moveTo(x: number, y: number) {
    if (arguments.length < 2) need(arguments.length, 2);
    this.#path.moveTo(+x, +y);
  }

  lineTo(x: number, y: number) {
    if (arguments.length < 2) need(arguments.length, 2);
    this.#path.lineTo(+x, +y);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#path.quadraticCurveTo(+cpx, +cpy, +x, +y);
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
    if (arguments.length < 6) need(arguments.length, 6);
    this.#path.bezierCurveTo(+cp1x, +cp1y, +cp2x, +cp2y, +x, +y);
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
    if (arguments.length < 5) need(arguments.length, 5);
    this.#path.arcTo(+x1, +y1, +x2, +y2, +radius);
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false) {
    if (arguments.length < 5) need(arguments.length, 5);
    this.#path.ellipse(+x, +y, +radius, +radius, 0, +startAngle, +endAngle, !!counterclockwise);
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ) {
    if (arguments.length < 7) need(arguments.length, 7);
    this.#path.ellipse(+x, +y, +radiusX, +radiusY, +rotation, +startAngle, +endAngle, !!counterclockwise);
  }

  rect(x: number, y: number, w: number, h: number) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#path.rect(+x, +y, +w, +h);
  }

  roundRect(x: number, y: number, w: number, h: number, radii: unknown = 0) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#path.roundRect(+x, +y, +w, +h, radii);
  }
}

// ───────────────────────────── styles ─────────────────────────────

/** What a gradient or a pattern is written as. */
class Paint {
  owner: CanvasGradient | CanvasPattern;
  operands: number[];
  /** Changes with the operands. */
  version = 0;
  isTainted = false;

  constructor(owner: CanvasGradient | CanvasPattern, operands: number[]) {
    this.owner = owner;
    this.operands = operands;
  }
}

let paintOfGradient: (gradient: CanvasGradient) => Paint;
let paintOfPattern: (pattern: CanvasPattern) => Paint;

function createGradient(given: number, geometry: number[]) {
  need(given, geometry.length - 1);
  if (!geometry.every(isFinite)) throw new TypeError("The provided double value is non-finite.");
  if (geometry[0] === 2 && (geometry[3] < 0 || geometry[6] < 0))
    throw indexSizeError("The radius provided is less than 0.");
  return new CanvasGradient(kInternal, geometry);
}

class CanvasGradient {
  #paint: Paint;
  #firstStop: number;

  static {
    paintOfGradient = gradient => gradient.#paint;
  }

  constructor(key: unknown = undefined, geometry: number[] = []) {
    checkInternal(key);
    this.#firstStop = geometry.push(0);
    this.#paint = new Paint(this, geometry);
  }

  addColorStop(offset: number, color: string) {
    need(arguments.length, 2);
    offset = +offset;
    if (!isFinite(offset)) throw new TypeError("The provided double value is non-finite.");
    if (offset < 0 || offset > 1)
      throw indexSizeError(`The provided value (${offset}) is outside the range (0.0, 1.0).`);
    const parsed = parseColor(String(color));
    if (parsed < 0)
      throw new DOMException(`The value provided ('${color}') could not be parsed as a color.`, "SyntaxError");
    const { operands } = this.#paint;
    let index = operands.length;
    while (index > this.#firstStop && operands[index - 2] > offset) index -= 2;
    operands.splice(index, 0, offset, parsed);
    operands[this.#firstStop - 1]++;
    this.#paint.version++;
  }
}

class CanvasPattern {
  #paint: Paint;

  static {
    paintOfPattern = pattern => pattern.#paint;
  }

  constructor(key: unknown = undefined, id = 0, repetition = "", isTainted = false) {
    checkInternal(key);
    const repeatsX = repetition === "repeat" || repetition === "repeat-x";
    const repeatsY = repetition === "repeat" || repetition === "repeat-y";
    this.#paint = new Paint(this, [4, id, +repeatsX, +repeatsY, 1, 0, 0, 1, 0, 0]);
    this.#paint.isTainted = isTainted;
    canvases.register(this, id);
  }

  setTransform(transform: unknown = undefined) {
    const matrix = matrixFrom(transform);
    if (!matrix.isFinite()) return;
    this.#paint.operands.splice(4, 6, matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    this.#paint.version++;
  }
}

const { isFloat16Array, isUint8ClampedArray } = require("node:util/types");
type Pixels = Uint8ClampedArray | Float16Array;
let isImageData: (value: unknown) => value is ImageData;

class ImageData {
  #data: Pixels;
  #width: number;
  #height: number;
  #colorSpace: string;

  static {
    isImageData = (value): value is ImageData => $isObject(value) && #data in (value as object);
  }

  constructor(dataOrWidth: any, widthOrHeight: number, third: any = undefined, fourth: unknown = undefined) {
    need(arguments.length, 2);
    const hasData = isUint8ClampedArray(dataOrWidth) || isFloat16Array(dataOrWidth);
    if (!hasData && arguments.length > 3) throw new TypeError("parameter 1 is not of type 'ImageDataArray'.");
    const { colorSpace, pixelFormat } = dictionary(hasData ? fourth : third);
    this.#colorSpace = oneOf(colorSpace, "srgb display-p3");
    const isFloat = oneOf(pixelFormat, "rgba-unorm8 rgba-float16") !== "rgba-unorm8";
    if (hasData) {
      const { length } = dataOrWidth;
      if (isFloat !== isFloat16Array(dataOrWidth)) throw invalidStateError("The array does not have the pixel format.");
      if (length === 0 || length % 4) throw invalidStateError("The input data length is not a non-zero multiple of 4.");
      this.#width = widthOrHeight >>> 0;
      this.#height = length / 4 / this.#width;
      if (!Number.isInteger(this.#height))
        throw indexSizeError("The input data length is not a multiple of (4 * width).");
      if (third !== undefined && third >>> 0 !== this.#height) {
        throw indexSizeError("The input data length is not equal to (4 * width * height).");
      }
      this.#data = dataOrWidth;
      return;
    }
    this.#width = dataOrWidth >>> 0;
    this.#height = widthOrHeight >>> 0;
    const length = this.#width * this.#height * 4;
    if (length === 0 || length >= 2 ** 32) throw indexSizeError("The source size is zero, not a number or too large.");
    this.#data = isFloat ? new Float16Array(length) : new Uint8ClampedArray(length);
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  get data() {
    return this.#data;
  }

  get colorSpace() {
    return this.#colorSpace;
  }

  get pixelFormat() {
    return isFloat16Array(this.#data) ? "rgba-float16" : "rgba-unorm8";
  }
}

function bytesOf({ data }: ImageData) {
  if (data.length === 0) throw invalidStateError("The source data has been detached.");
  if (isFloat16Array(data)) data = Uint8ClampedArray.from(data, value => value * 255);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

class TextMetrics {
  #values: Float64Array;

  constructor(key: unknown = undefined, values = measured) {
    checkInternal(key);
    this.#values = values;
  }

  get width() {
    return this.#values[0];
  }

  get actualBoundingBoxLeft() {
    return this.#values[1];
  }

  get actualBoundingBoxRight() {
    return this.#values[2];
  }

  get actualBoundingBoxAscent() {
    return this.#values[3];
  }

  get actualBoundingBoxDescent() {
    return this.#values[4];
  }

  get fontBoundingBoxAscent() {
    return this.#values[5];
  }

  get fontBoundingBoxDescent() {
    return this.#values[6];
  }

  get emHeightAscent() {
    return this.#values[7];
  }

  get emHeightDescent() {
    return this.#values[8];
  }

  get hangingBaseline() {
    return this.#values[9];
  }

  get alphabeticBaseline() {
    return this.#values[10];
  }

  get ideographicBaseline() {
    return this.#values[11];
  }
}

function checkImageSource(source: any) {
  if (typeof source !== "object" || source === null || !(kImageId in source)) {
    throw new TypeError("The provided value is not of type 'CanvasImageSource'.");
  }
}

// ───────────────────────────── the context ─────────────────────────────

const composites =
  "source-over source-in source-out source-atop destination-over destination-in destination-out destination-atop lighter copy xor multiply screen overlay darken lighten color-dodge color-burn hard-light soft-light difference exclusion hue saturation color luminosity clear".split(
    " ",
  );
const lineCaps = ["butt", "round", "square"];
const lineJoins = ["miter", "round", "bevel"];
const baselines = ["alphabetic", "top", "hanging", "middle", "ideographic", "bottom"];
const qualities = ["low", "medium", "high"];
const alignments = ["start", "end", "left", "right", "center"];
const renderings = ["auto", "optimizeSpeed", "optimizeLegibility", "geometricPrecision"];
const kernings = ["auto", "normal", "none"];
const whitespace = /[\t\n\f\r]/g;
const currentColor = /currentcolor/i;
const isRelative = /\d(?:r?(?:em|ex|ch|ic|cap|lh)|%)|larger|smaller/i;
const fontIds = new Map<string, number>();
const defaultFont = parseFont("10px sans-serif", 10, 16)!;

const fonts = new Map<string, Font | undefined>();
let fontsEm = 0;
let fontsRem = 0;

function cachedFont(text: string, em: number, rem: number): Font | undefined {
  if (em !== fontsEm || rem !== fontsRem || fonts.$size > 256) {
    fonts.clear();
    fontsEm = em;
    fontsRem = rem;
  }
  let font = fonts.$get(text);
  if (font === undefined) fonts.$set(text, (font = parseFont(text, em, rem)));
  return font;
}

const noDash: number[] = [];

const MAX_AREA = 1 << 28;

class State {
  matrix = identity;
  /** Unless there is a paint. */
  fillColor = 255;
  strokeColor = 255;
  fillPaint: Paint | null = null;
  strokePaint: Paint | null = null;
  /** Of the paints when they were written. */
  fillVersion = 0;
  strokeVersion = 0;
  globalAlpha = 1;
  globalCompositeOperation = "source-over";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  miterLimit = 10;
  lineDash = noDash;
  lineDashOffset = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  shadowBlur = 0;
  shadowColor = 0;
  imageSmoothingEnabled = true;
  imageSmoothingQuality = "low";
  filter = "none";
  font = defaultFont;
  fontId = -1;
  fontKerning = "auto";
  fontStretch = "normal";
  fontVariantCaps = "normal";
  textRendering = "auto";
  textAlign = "start";
  textBaseline = "alphabetic";
  direction = "inherit";
  lang = "inherit";
  letterSpacing = "0px";
  wordSpacing = "0px";

  clone(): State {
    const copy = new State();
    copy.matrix = this.matrix;
    copy.fillColor = this.fillColor;
    copy.strokeColor = this.strokeColor;
    copy.fillPaint = this.fillPaint;
    copy.strokePaint = this.strokePaint;
    copy.fillVersion = this.fillVersion;
    copy.strokeVersion = this.strokeVersion;
    copy.globalAlpha = this.globalAlpha;
    copy.globalCompositeOperation = this.globalCompositeOperation;
    copy.lineWidth = this.lineWidth;
    copy.lineCap = this.lineCap;
    copy.lineJoin = this.lineJoin;
    copy.miterLimit = this.miterLimit;
    copy.lineDash = this.lineDash;
    copy.lineDashOffset = this.lineDashOffset;
    copy.shadowOffsetX = this.shadowOffsetX;
    copy.shadowOffsetY = this.shadowOffsetY;
    copy.shadowBlur = this.shadowBlur;
    copy.shadowColor = this.shadowColor;
    copy.imageSmoothingEnabled = this.imageSmoothingEnabled;
    copy.imageSmoothingQuality = this.imageSmoothingQuality;
    copy.filter = this.filter;
    copy.font = this.font;
    copy.fontId = this.fontId;
    copy.fontKerning = this.fontKerning;
    copy.fontStretch = this.fontStretch;
    copy.fontVariantCaps = this.fontVariantCaps;
    copy.textRendering = this.textRendering;
    copy.textAlign = this.textAlign;
    copy.textBaseline = this.textBaseline;
    copy.direction = this.direction;
    copy.lang = this.lang;
    copy.letterSpacing = this.letterSpacing;
    copy.wordSpacing = this.wordSpacing;
    return copy;
  }
}

class CanvasRenderingContext2D {
  #canvas: Host;
  #id: number;
  #width: number;
  #height: number;
  #settings: { alpha: boolean; colorSpace: string };
  #isTainted = false;
  #saved: State[] = [];
  #inheritedAt = -1;
  #lastInherited?: ReturnType<typeof hooks.inherited>;
  #state = new State();
  #path = new PathBuilder();
  #drawnAt = -1;

  constructor(key: unknown = undefined, canvas: Host = { width: 0, height: 0 }, settings: any = undefined) {
    checkInternal(key);
    const {
      alpha = true,
      colorSpace,
      colorType,
      desynchronized,
      willReadFrequently,
    } = $isObject(settings) ? settings : {};
    this.#canvas = canvas;
    this.#width = canvas.width;
    this.#height = canvas.height;
    this.#settings = {
      alpha: !!alpha,
      colorSpace: oneOf(colorSpace, "srgb display-p3"),
      colorType: oneOf(colorType, "unorm8 float16"),
      desynchronized: !!desynchronized,
      willReadFrequently: !!willReadFrequently,
    } as any;
    this.#id = +native.ask("canvas.create", {
      width: this.#width,
      height: this.#height,
      opaque: !this.#settings.alpha,
    });
    canvases.register(this, this.#id);
  }

  get [kImageId]() {
    return this.#id;
  }

  get [kImageSize]() {
    return [this.#width, this.#height];
  }

  get [kIsTainted]() {
    return this.#isTainted;
  }

  /** Makes it show the bitmap and nothing else. */
  [kAdopt](bitmap: ImageBitmap) {
    this[kResize](bitmap.width, bitmap.height);
    this.drawImage(bitmap, 0, 0);
    bitmap.close();
  }

  /** Leaves the state as it is. */
  [kErase]() {
    flush();
    this.#isTainted = false;
    native.send("canvas.erase", { id: this.#id });
    this.#canvas.invalidate?.();
  }

  [kResize](width: number, height: number) {
    flush();
    this.#isTainted = false;
    this.#width = width;
    this.#height = height;
    this.#saved = [];
    this.#state = new State();
    this.#path = new PathBuilder();
    native.send("canvas.resize", { id: this.#id, width, height });
    this.#canvas.invalidate?.();
  }

  #encodeOptions(type: unknown, quality: unknown) {
    requireClean(this);
    flush();
    if (this.#width === 0 || this.#height === 0 || this.#width * this.#height > MAX_AREA) return;
    return {
      id: this.#id,
      type,
      quality: typeof quality === "number" && quality >= 0 && quality <= 1 ? quality : null,
    };
  }

  [kEncodeSync](type: string, quality?: number): Buffer | null {
    const options = this.#encodeOptions(type, quality);
    return options ? native.takeBlob(native.ask("canvas.encode", options)) : null;
  }

  async [kEncode](type: string, quality?: number): Promise<Buffer | null> {
    const options = this.#encodeOptions(type, quality);
    return options ? native.takeBlob(await native.request("canvas.encode", options)) : null;
  }

  /** Asked once for all the text of a frame. */
  #inherited() {
    if (this.#inheritedAt !== flushes) {
      this.#inheritedAt = flushes;
      this.#lastInherited = hooks.inherited(this.#canvas);
      queueFlush();
    }
    return this.#lastInherited!;
  }

  #begin(operation: Op) {
    if (stream.length > 1 << 17) flush();
    queueFlush();
    if (selected !== this.#id) stream.push2(Op.Select, (selected = this.#id));
    stream.push(operation);
  }

  #writeColor(operation: Op, color: number) {
    this.#begin(operation);
    stream.push2(0, color);
  }

  #writePaint(operation: Op, paint: Paint): number {
    if (paint.isTainted) this.#isTainted = true;
    this.#begin(operation);
    stream.pushAll(paint.operands);
    return paint.version;
  }

  #beginDrawing(operation: Op) {
    const state = this.#state;
    const { fillPaint, strokePaint } = state;
    if (fillPaint !== null && fillPaint.version !== state.fillVersion) {
      state.fillVersion = this.#writePaint(Op.FillStyle, fillPaint);
    }
    if (strokePaint !== null && strokePaint.version !== state.strokeVersion) {
      state.strokeVersion = this.#writePaint(Op.StrokeStyle, strokePaint);
    }
    this.#begin(operation);
    if (this.#drawnAt === flushes) return;
    this.#drawnAt = flushes;
    changed.push(this.#canvas);
  }

  #writeLine(to: Stream) {
    const state = this.#state;
    to.push4(state.lineWidth, state.miterLimit, state.lineDashOffset, lineCaps.indexOf(state.lineCap));
    to.push2(lineJoins.indexOf(state.lineJoin), state.lineDash.length);
    to.pushAll(state.lineDash);
  }

  #changed(operation: Op) {
    const state = this.#state;
    this.#begin(operation);
    if (operation === Op.Line) this.#writeLine(stream);
    else if (operation === Op.Alpha) stream.push(state.globalAlpha);
    else if (operation === Op.Composite) stream.push(composites.indexOf(state.globalCompositeOperation));
    else if (operation === Op.Smoothing) stream.push(+state.imageSmoothingEnabled);
    else stream.push4(state.shadowOffsetX, state.shadowOffsetY, state.shadowBlur, state.shadowColor);
  }

  get canvas() {
    return this.#canvas.canvas ?? this.#canvas;
  }

  getContextAttributes() {
    return { ...this.#settings };
  }

  isContextLost() {
    return false;
  }

  reset() {
    const isTainted = this.#isTainted;
    this[kResize](this.#width, this.#height);
    this.#isTainted = isTainted;
  }

  save() {
    this.#saved.push(this.#state.clone());
    this.#begin(Op.Save);
  }

  restore() {
    const state = this.#saved.pop();
    if (state === undefined) return;
    this.#state = state;
    this.#path.matrix = state.matrix;
    this.#begin(Op.Restore);
  }

  #setMatrix(matrix: Matrix) {
    if (!matrix.isFinite()) return;
    this.#state.matrix = this.#path.matrix = matrix;
    this.#begin(Op.Transform);
    stream.pushMatrix(matrix);
  }

  #transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const m = this.#state.matrix;
    this.#setMatrix(
      new Matrix(
        m.a * a + m.c * b,
        m.b * a + m.d * b,
        m.a * c + m.c * d,
        m.b * c + m.d * d,
        m.a * e + m.c * f + m.e,
        m.b * e + m.d * f + m.f,
      ),
    );
  }

  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    if (arguments.length < 6) need(arguments.length, 6);
    this.#transform(+a, +b, +c, +d, +e, +f);
  }

  scale(x: number, y: number) {
    if (arguments.length < 2) need(arguments.length, 2);
    this.#transform(+x, 0, 0, +y, 0, 0);
  }

  rotate(angle: number) {
    if (arguments.length < 1) need(arguments.length, 1);
    angle = +angle;
    this.#transform(cos(angle), sin(angle), -sin(angle), cos(angle), 0, 0);
  }

  translate(x: number, y: number) {
    if (arguments.length < 2) need(arguments.length, 2);
    this.#transform(1, 0, 0, 1, +x, +y);
  }

  setTransform(a: any = undefined, b?, c?, d?, e?, f?) {
    if (arguments.length > 1 && arguments.length < 6) {
      throw new TypeError(`Valid arities are: [0, 1, 6], but ${arguments.length} arguments provided.`);
    }
    this.#setMatrix(arguments.length > 1 ? new Matrix(+a, +b, +c, +d, +e, +f) : matrixFrom(a));
  }

  resetTransform() {
    this.#setMatrix(identity);
  }

  getTransform() {
    const { a, b, c, d, e, f } = this.#state.matrix;
    return new DOMMatrix([a, b, c, d, e, f]);
  }

  #parseColor(value: unknown): number {
    const text = typeof value === "string" ? value : `${value}`;
    if (text.length < 12 || !currentColor.test(text)) return parseColor(text);
    return +engine.parseColor(text, parseColor(hooks.inherited(this.#canvas).color));
  }

  #paintOf(value: unknown): Paint | null {
    if (typeof value === "string") return null;
    if (value instanceof CanvasGradient) return paintOfGradient(value);
    return value instanceof CanvasPattern ? paintOfPattern(value) : null;
  }

  get fillStyle(): string | CanvasGradient | CanvasPattern {
    return this.#state.fillPaint?.owner ?? serializeColor(this.#state.fillColor);
  }

  set fillStyle(value: unknown) {
    const state = this.#state;
    const paint = this.#paintOf(value);
    if (paint !== null) {
      if (paint !== state.fillPaint) state.fillVersion = this.#writePaint(Op.FillStyle, (state.fillPaint = paint));
      return;
    }
    const color = this.#parseColor(value);
    if (color < 0 || (color === state.fillColor && state.fillPaint === null)) return;
    state.fillPaint = null;
    this.#writeColor(Op.FillStyle, (state.fillColor = color));
  }

  get strokeStyle(): string | CanvasGradient | CanvasPattern {
    return this.#state.strokePaint?.owner ?? serializeColor(this.#state.strokeColor);
  }

  set strokeStyle(value: unknown) {
    const state = this.#state;
    const paint = this.#paintOf(value);
    if (paint !== null) {
      if (paint !== state.strokePaint)
        state.strokeVersion = this.#writePaint(Op.StrokeStyle, (state.strokePaint = paint));
      return;
    }
    const color = this.#parseColor(value);
    if (color < 0 || (color === state.strokeColor && state.strokePaint === null)) return;
    state.strokePaint = null;
    this.#writeColor(Op.StrokeStyle, (state.strokeColor = color));
  }

  get globalAlpha() {
    return this.#state.globalAlpha;
  }

  set globalAlpha(value: number) {
    value = +value;
    if (!(value >= 0 && value <= 1) || value === this.#state.globalAlpha) return;
    this.#state.globalAlpha = value;
    this.#changed(Op.Alpha);
  }

  get globalCompositeOperation() {
    return this.#state.globalCompositeOperation;
  }

  set globalCompositeOperation(value: string) {
    value = String(value);
    if (!composites.includes(value) || value === this.#state.globalCompositeOperation) return;
    this.#state.globalCompositeOperation = value;
    this.#changed(Op.Composite);
  }

  get lineWidth() {
    return this.#state.lineWidth;
  }

  set lineWidth(value: number) {
    value = +value;
    if (!(value > 0 && value < Infinity) || value === this.#state.lineWidth) return;
    this.#state.lineWidth = value;
    this.#changed(Op.Line);
  }

  get miterLimit() {
    return this.#state.miterLimit;
  }

  set miterLimit(value: number) {
    value = +value;
    if (!(value > 0 && value < Infinity) || value === this.#state.miterLimit) return;
    this.#state.miterLimit = value;
    this.#changed(Op.Line);
  }

  get lineDashOffset() {
    return this.#state.lineDashOffset;
  }

  set lineDashOffset(value: number) {
    value = +value;
    if (!isFinite(value) || value === this.#state.lineDashOffset) return;
    this.#state.lineDashOffset = value;
    this.#changed(Op.Line);
  }

  get lineCap() {
    return this.#state.lineCap;
  }

  set lineCap(value: string) {
    value = String(value);
    if (!lineCaps.includes(value) || value === this.#state.lineCap) return;
    this.#state.lineCap = value;
    this.#changed(Op.Line);
  }

  get lineJoin() {
    return this.#state.lineJoin;
  }

  set lineJoin(value: string) {
    value = String(value);
    if (!lineJoins.includes(value) || value === this.#state.lineJoin) return;
    this.#state.lineJoin = value;
    this.#changed(Op.Line);
  }

  get shadowOffsetX() {
    return this.#state.shadowOffsetX;
  }

  set shadowOffsetX(value: number) {
    value = +value;
    if (!isFinite(value) || value === this.#state.shadowOffsetX) return;
    this.#state.shadowOffsetX = value;
    this.#changed(Op.Shadow);
  }

  get shadowOffsetY() {
    return this.#state.shadowOffsetY;
  }

  set shadowOffsetY(value: number) {
    value = +value;
    if (!isFinite(value) || value === this.#state.shadowOffsetY) return;
    this.#state.shadowOffsetY = value;
    this.#changed(Op.Shadow);
  }

  get shadowBlur() {
    return this.#state.shadowBlur;
  }

  set shadowBlur(value: number) {
    value = +value;
    if (!(value >= 0 && value < Infinity) || value === this.#state.shadowBlur) return;
    this.#state.shadowBlur = value;
    this.#changed(Op.Shadow);
  }

  get imageSmoothingQuality() {
    return this.#state.imageSmoothingQuality;
  }

  set imageSmoothingQuality(value: string) {
    value = String(value);
    if (qualities.includes(value)) this.#state.imageSmoothingQuality = value;
  }

  get textAlign() {
    return this.#state.textAlign;
  }

  set textAlign(value: string) {
    value = String(value);
    if (alignments.includes(value)) this.#state.textAlign = value;
  }

  get textBaseline() {
    return this.#state.textBaseline;
  }

  set textBaseline(value: string) {
    value = String(value);
    if (baselines.includes(value)) this.#state.textBaseline = value;
  }

  get textRendering() {
    return this.#state.textRendering;
  }

  set textRendering(value: string) {
    value = String(value);
    if (renderings.includes(value)) this.#state.textRendering = value;
  }

  get fontKerning() {
    return this.#state.fontKerning;
  }

  set fontKerning(value: string) {
    value = String(value);
    if (!kernings.includes(value) || value === this.#state.fontKerning) return;
    this.#state.fontKerning = value;
    this.#state.fontId = -1;
  }

  get fontStretch() {
    return this.#state.fontStretch;
  }

  set fontStretch(value: string) {
    value = String(value);
    if (!(value in fontStretches) || value === this.#state.fontStretch) return;
    this.#state.fontStretch = value;
    this.#state.fontId = -1;
  }

  get fontVariantCaps() {
    return this.#state.fontVariantCaps;
  }

  set fontVariantCaps(value: string) {
    value = String(value);
    if (!(value in capsFeatures) || value === this.#state.fontVariantCaps) return;
    this.#state.fontVariantCaps = value;
    this.#state.fontId = -1;
  }

  get shadowColor() {
    return serializeColor(this.#state.shadowColor);
  }

  set shadowColor(value) {
    const color = this.#parseColor(value);
    if (color < 0) return;
    this.#state.shadowColor = color;
    this.#changed(Op.Shadow);
  }

  get imageSmoothingEnabled() {
    return this.#state.imageSmoothingEnabled;
  }

  set imageSmoothingEnabled(value) {
    this.#state.imageSmoothingEnabled = !!value;
    this.#changed(Op.Smoothing);
  }

  get filter() {
    return this.#state.filter;
  }

  set filter(value) {
    const text = String(value).trim();
    const operands = parseFilter(text, this.#state.font.size, this.#inherited().rootFontSize);
    if (operands === undefined) return;
    this.#state.filter = text;
    this.#begin(Op.Filter);
    stream.pushAll(operands);
  }

  getLineDash() {
    return this.#state.lineDash.slice();
  }

  setLineDash(segments: Iterable<number>) {
    if (!$isObject(segments)) throw new TypeError("The provided value cannot be converted to a sequence.");
    const lengths: number[] = [];
    for (const length of segments) lengths.push(+length);
    if (!lengths.every(length => isFinite(length) && length >= 0)) return;
    this.#state.lineDash = lengths.length % 2 ? lengths.concat(lengths) : lengths;
    this.#changed(Op.Line);
  }

  createLinearGradient(x0, y0, x1, y1) {
    return createGradient(arguments.length, [1, +x0, +y0, +x1, +y1]);
  }

  createRadialGradient(x0, y0, r0, x1, y1, r1) {
    return createGradient(arguments.length, [2, +x0, +y0, +r0, +x1, +y1, +r1]);
  }

  createConicGradient(startAngle, x, y) {
    return createGradient(arguments.length, [3, +startAngle, +x, +y]);
  }

  createPattern(image, repetition: string | null) {
    this.#id;
    need(arguments.length, 2);
    checkImageSource(image);
    repetition = (repetition === null ? "" : `${repetition}`) || "repeat";
    if (!["repeat", "repeat-x", "repeat-y", "no-repeat"].includes(repetition)) {
      throw new DOMException(`The provided type ('${repetition}') is not a repetition.`, "SyntaxError");
    }
    const id = image[kImageId];
    if (!id) return null;
    const [width, height] = image[kImageSize];
    if (!width || !height) throw invalidStateError("The image has a width or height of 0.");
    return new CanvasPattern(
      kInternal,
      snapshot("canvas.pattern", { id }, width, height),
      repetition,
      !!image[kIsTainted],
    );
  }

  #rect(operation: Op, x: number, y: number, width: number, height: number) {
    if (!allFinite(x, y, width, height)) return;
    this.#beginDrawing(operation);
    stream.push4(x, y, width, height);
  }

  fillRect(x: number, y: number, w: number, h: number) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#rect(Op.FillRect, +x, +y, +w, +h);
  }

  strokeRect(x: number, y: number, w: number, h: number) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#rect(Op.StrokeRect, +x, +y, +w, +h);
  }

  clearRect(x: number, y: number, w: number, h: number) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#rect(Op.ClearRect, +x, +y, +w, +h);
  }

  beginPath() {
    this.#path.clear();
  }

  closePath() {
    this.#path.closePath();
  }

  moveTo(x: number, y: number) {
    if (arguments.length < 2) need(arguments.length, 2);
    this.#path.moveTo(+x, +y);
  }

  lineTo(x: number, y: number) {
    if (arguments.length < 2) need(arguments.length, 2);
    this.#path.lineTo(+x, +y);
  }

  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#path.quadraticCurveTo(+cpx, +cpy, +x, +y);
  }

  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number) {
    if (arguments.length < 6) need(arguments.length, 6);
    this.#path.bezierCurveTo(+cp1x, +cp1y, +cp2x, +cp2y, +x, +y);
  }

  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number) {
    if (arguments.length < 5) need(arguments.length, 5);
    this.#path.arcTo(+x1, +y1, +x2, +y2, +radius);
  }

  arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise = false) {
    if (arguments.length < 5) need(arguments.length, 5);
    this.#path.ellipse(+x, +y, +radius, +radius, 0, +startAngle, +endAngle, !!counterclockwise);
  }

  ellipse(
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rotation: number,
    startAngle: number,
    endAngle: number,
    counterclockwise = false,
  ) {
    if (arguments.length < 7) need(arguments.length, 7);
    this.#path.ellipse(+x, +y, +radiusX, +radiusY, +rotation, +startAngle, +endAngle, !!counterclockwise);
  }

  rect(x: number, y: number, w: number, h: number) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#path.rect(+x, +y, +w, +h);
  }

  roundRect(x: number, y: number, w: number, h: number, radii: unknown = 0) {
    if (arguments.length < 4) need(arguments.length, 4);
    this.#path.roundRect(+x, +y, +w, +h, radii);
  }

  #writePath(to: Stream, path: unknown) {
    if (path instanceof Path2D) to.pushPath(segmentsOf(path), this.#state.matrix);
    else to.pushPath(this.#path.segments, identity);
  }

  #isEvenOdd(rule: unknown = "nonzero") {
    if (rule !== "nonzero" && rule !== "evenodd") {
      throw new TypeError(`The provided value '${rule}' is not a valid enum value of type CanvasFillRule.`);
    }
    return +(rule === "evenodd");
  }

  #ruleOf(path: unknown, rule: unknown, count: number) {
    if (path instanceof Path2D) return this.#isEvenOdd(rule);
    if (count > 1) throw new TypeError("parameter 1 is not of type 'Path2D'.");
    return this.#isEvenOdd(path);
  }

  fill(path: unknown = undefined, rule?) {
    const isEvenOdd = this.#ruleOf(path, rule, arguments.length);
    this.#beginDrawing(Op.Fill);
    stream.push(isEvenOdd);
    this.#writePath(stream, path);
  }

  stroke(path: unknown = undefined) {
    if (arguments.length > 0 && !(path instanceof Path2D)) throw new TypeError("parameter 1 is not of type 'Path2D'.");
    this.#beginDrawing(Op.Stroke);
    this.#writePath(stream, path);
  }

  clip(path: unknown = undefined, rule?) {
    const isEvenOdd = this.#ruleOf(path, rule, arguments.length);
    this.#begin(Op.Clip);
    stream.push(isEvenOdd);
    this.#writePath(stream, path);
  }

  isPointInPath(path, x, y: any = undefined, rule: unknown = undefined) {
    need(arguments.length, 2);
    if (!(path instanceof Path2D)) {
      if (arguments.length > 3) throw new TypeError("parameter 1 is not of type 'Path2D'.");
      [x, y, rule] = [path, x, y];
    }
    const isEvenOdd = this.#isEvenOdd(rule);
    if (!allFinite(+x, +y)) return false;
    const question = new Stream();
    question.pushAll([+x, +y, isEvenOdd]);
    this.#writePath(question, path);
    return native.ask("canvas.hitTest", { blob: question.take() }) === true;
  }

  isPointInStroke(path, x, y: any = undefined) {
    need(arguments.length, 2);
    if (!(path instanceof Path2D)) {
      if (arguments.length > 2) throw new TypeError("parameter 1 is not of type 'Path2D'.");
      [x, y] = [path, x];
    }
    if (!allFinite(+x, +y)) return false;
    const question = new Stream();
    question.push2(+x, +y);
    question.pushMatrix(this.#state.matrix);
    this.#writeLine(question);
    this.#writePath(question, path);
    return native.ask("canvas.hitTest", { blob: question.take(), stroke: true }) === true;
  }

  drawFocusIfNeeded(path, element: unknown = undefined) {
    if (!hooks.isFocused(this.#canvas, path instanceof Path2D ? element : path)) return;
    this.save();
    Object.assign(this, {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      lineWidth: 2,
      shadowColor: "#0000",
      strokeStyle: "#101010",
    });
    this.setLineDash([]);
    this.#beginDrawing(Op.Stroke);
    this.#writePath(stream, path);
    this.restore();
  }

  get font() {
    return this.#state.font.text;
  }

  set font(value) {
    const state = this.#state;
    const text = String(value);
    if (text === state.font.text) return;
    const { fontSize, rootFontSize } = isRelative.test(text) ? hooks.inherited(this.#canvas) : this.#inherited();
    const font = cachedFont(text, +fontSize, +rootFontSize);
    if (font === undefined) return;
    state.font = font;
    state.fontStretch = font.stretch;
    state.fontVariantCaps = font.caps;
    state.fontId = -1;
  }

  get letterSpacing() {
    return this.#state.letterSpacing;
  }

  set letterSpacing(value: string) {
    value = String(value).trim().toLowerCase();
    if (isFinite(parseLength(value, 1, 1))) this.#state.letterSpacing = value;
  }

  get wordSpacing() {
    return this.#state.wordSpacing;
  }

  set wordSpacing(value: string) {
    value = String(value).trim().toLowerCase();
    if (isFinite(parseLength(value, 1, 1))) this.#state.wordSpacing = value;
  }

  get lang() {
    return this.#state.lang;
  }

  set lang(value) {
    this.#state.lang = String(value);
    this.#state.fontId = -1;
  }

  get direction() {
    return this.#state.direction;
  }

  #isRightToLeft() {
    const { direction } = this.#state;
    return (direction === "inherit" ? this.#inherited().direction : direction) === "rtl";
  }

  set direction(value) {
    value = String(value);
    if (value === "ltr" || value === "rtl" || value === "inherit") this.#state.direction = value;
  }

  #fontId(): number {
    const state = this.#state;
    const { font } = state;
    if (state.fontId < 0) {
      const scope = this.#inherited().fontScope;
      const language = state.lang === "inherit" ? this.#inherited().language : state.lang;
      const key = [scope, language, state.fontKerning, state.fontStretch, state.fontVariantCaps, font.text].join();
      let id = fontIds.$get(key);
      if (id === undefined) {
        hooks.useFont(this.#canvas, font);
        id = native.ask("canvas.font", {
          ...font,
          scope,
          language,
          stretch: fontStretches[state.fontStretch],
          kerning: state.fontKerning !== "none",
          features: capsFeatures[state.fontVariantCaps],
        }) as number;
        if (fontIds.$size > 1024) fontIds.clear();
        fontIds.$set(key, id);
      }
      state.fontId = +id;
    }
    return state.fontId;
  }

  #spacing(text: string): number {
    return text === "0px" ? 0 : parseLength(text, this.#state.font.size, this.#inherited().rootFontSize);
  }

  /** How much of the text is left of the x coordinate. */
  #alignment() {
    const { textAlign } = this.#state;
    if (textAlign === "center") return 0.5;
    if (textAlign === "left" || textAlign === "right") return +(textAlign === "right");
    return +((textAlign === "end") !== this.#isRightToLeft());
  }

  #text(operation: Op, text: unknown, x: number, y: number, maxWidth: unknown) {
    const limit = maxWidth === undefined ? Infinity : +maxWidth!;
    if (!allFinite(x, y) || !(limit > 0)) return;
    const state = this.#state;
    const font = this.#fontId();
    this.#beginDrawing(operation);
    texts += String(text).replace(whitespace, " ").replaceAll("\0", "") + "\0";
    stream.push4(font, state.font.size, this.#spacing(state.letterSpacing), this.#spacing(state.wordSpacing));
    stream.push4(+this.#isRightToLeft(), x, y, this.#alignment());
    stream.push2(limit, baselines.indexOf(state.textBaseline));
  }

  fillText(text: string, x: number, y: number, maxWidth: unknown = undefined) {
    if (arguments.length < 3) need(arguments.length, 3);
    this.#text(Op.FillText, text, +x, +y, maxWidth);
  }

  strokeText(text: string, x: number, y: number, maxWidth: unknown = undefined) {
    if (arguments.length < 3) need(arguments.length, 3);
    this.#text(Op.StrokeText, text, +x, +y, maxWidth);
  }

  measureText(text: string) {
    if (arguments.length < 1) need(arguments.length, 1);
    const state = this.#state;
    measured[0] = this.#fontId();
    measured[1] = state.font.size;
    measured[2] = this.#spacing(state.letterSpacing);
    measured[3] = this.#spacing(state.wordSpacing);
    measured[4] = +this.#isRightToLeft();
    measured[5] = baselines.indexOf(state.textBaseline);
    nativeMeasure(measured, String(text).replace(whitespace, " "));
    const values = measured.slice();
    const shift = values[0] * this.#alignment();
    values[1] += shift;
    values[2] -= shift;
    return new TextMetrics(kInternal, values);
  }

  drawImage(image, sx, sy, sw: any = undefined, sh?, dx?, dy?, dw?, dh?) {
    const count = arguments.length;
    if (count !== 3 && count !== 5 && count < 9) {
      throw new TypeError(`Valid arities are: [3, 5, 9], but ${count} arguments provided.`);
    }
    checkImageSource(image);
    const id = +image[kImageId];
    if (!id) return;
    const size = image[kImageSize];
    const width = +size[0];
    const height = +size[1];
    if (!width || !height) throw invalidStateError("The image argument has a width or height of 0.");
    if (image[kIsTainted]) this.#isTainted = true;
    if (count === 3) this.#drawImage(id, width, height, 0, 0, width, height, +sx, +sy, width, height);
    else if (count === 5) this.#drawImage(id, width, height, 0, 0, width, height, +sx, +sy, +sw, +sh);
    else this.#drawImage(id, width, height, +sx, +sy, +sw, +sh, +dx, +dy, +dw, +dh);
  }

  #drawImage(
    id: number,
    width: number,
    height: number,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ) {
    if (!allFinite(sx, sy, sw, sh) || !allFinite(dx, dy, dw, dh) || !(sw * sh * dw * dh)) return;
    this.#beginDrawing(Op.DrawImage);
    stream.push(id);
    stream.push2(width, height);
    stream.push4(sx, sy, sw, sh);
    stream.push4(dx, dy, dw, dh);
  }

  createImageData(width, height: unknown = undefined, settings: unknown = undefined) {
    const { colorSpace } = this.#settings;
    if (arguments.length > 1)
      return new ImageData(abs(enforce(width)), abs(enforce(height)), { colorSpace, ...dictionary(settings) });
    if (!isImageData(width)) throw new TypeError("parameter 1 is not of type 'ImageData'.");
    return new ImageData(width.width, width.height, width);
  }

  getImageData(x, y, width, height, settings: unknown = undefined) {
    const { colorSpace = this.#settings.colorSpace, pixelFormat } = dictionary(settings);
    [x, y, width, height] = normalize(enforce(x), enforce(y), enforce(width), enforce(height));
    if (width === 0 || height === 0) throw indexSizeError(`The source ${width ? "height" : "width"} is 0.`);
    requireClean(this);
    if (width * height > MAX_AREA) throw new RangeError("Out of memory at ImageData creation");
    flush();
    const bytes = native.takeBlob(native.ask("canvas.getImageData", { id: this.#id, x, y, width, height }));
    const data =
      pixelFormat === "rgba-float16" ? Float16Array.from(bytes, value => value / 255) : new Uint8ClampedArray(bytes);
    return new ImageData(data, width, height, { colorSpace, pixelFormat });
  }

  putImageData(image: ImageData, x, y, dirtyX: unknown = undefined, dirtyY?, dirtyWidth?, dirtyHeight?) {
    const count = arguments.length;
    if (count !== 3 && count < 7) throw new TypeError(`Valid arities are: [3, 7], but ${count} arguments provided.`);
    if (!isImageData(image)) throw new TypeError("parameter 1 is not of type 'ImageData'.");
    const { width, height } = image;
    x = enforce(x);
    y = enforce(y);
    const dirty =
      count === 3
        ? [0, 0, width, height]
        : normalize(enforce(dirtyX), enforce(dirtyY), enforce(dirtyWidth), enforce(dirtyHeight));
    flush();
    native.send("canvas.putImageData", {
      id: this.#id,
      blob: native.putBlob(bytesOf(image)),
      x,
      y,
      width,
      height,
      dirty: { x: x + dirty[0], y: y + dirty[1], width: dirty[2], height: dirty[3] },
    });
    this.#canvas.invalidate?.();
  }
}

function normalize(x: number, y: number, width: number, height: number) {
  return [min(x, x + width), min(y, y + height), abs(width), abs(height)];
}

class OffscreenCanvasRenderingContext2D {
  constructor() {
    core.illegalConstructor();
  }
}
{
  const { constructor, drawFocusIfNeeded, ...members } = Object.getOwnPropertyDescriptors(
    CanvasRenderingContext2D.prototype,
  );
  Object.defineProperties(OffscreenCanvasRenderingContext2D.prototype, members);
}

function createContext(canvas: Host, settings?: object) {
  return new CanvasRenderingContext2D(kInternal, canvas, settings);
}

// ───────────────────────────── bitmaps ─────────────────────────────

function snapshot(command: string, source: object, width: number, height: number, part?: object): number {
  flush();
  const all = { x: 0, y: 0, width, height, toWidth: ceil(width), toHeight: ceil(height) };
  return native.ask(command, { ...source, ...all, ...part, sourceWidth: width, sourceHeight: height });
}

let takeId: (bitmap: ImageBitmap) => number;

class ImageBitmap {
  #id: number;
  #width: number;
  #height: number;
  #isTainted: boolean;

  static {
    takeId = bitmap => {
      const id = bitmap.#id;
      bitmaps.unregister(bitmap);
      bitmap.#id = bitmap.#width = bitmap.#height = 0;
      return id;
    };
  }

  constructor(key: unknown = undefined, id = 0, width = 0, height = 0, isTainted = false) {
    checkInternal(key);
    this.#id = id;
    this.#width = width;
    this.#height = height;
    this.#isTainted = isTainted;
    bitmaps.register(this, id, this);
  }

  get [kImageId]() {
    if (this.#id === 0) throw invalidStateError("The image source is detached.");
    return this.#id;
  }

  get [kImageSize]() {
    return [this.#width, this.#height];
  }

  get [kIsTainted]() {
    return this.#isTainted;
  }

  get width() {
    return this.#width;
  }

  get height() {
    return this.#height;
  }

  close() {
    if (this.#id !== 0) release("image.release", takeId(this));
  }
}

const isBlob = (value: unknown) => /^\[object (?:Blob|File)]$/.test(Object.prototype.toString.$call(value));

async function createImageBitmap(image, x: any = undefined, y?, partWidth?, partHeight?, options?) {
  const count = arguments.length;
  const hasPart = count >= 5;
  if (count === 0 || count === 3 || count === 4)
    throw new TypeError(`Valid arities are: [1, 2, 5, 6], but ${count} arguments provided.`);
  if (!isBlob(image) && !isImageData(image)) checkImageSource(image);
  const { colorSpaceConversion, imageOrientation, premultiplyAlpha, resizeQuality, ...size } = dictionary(
    hasPart ? options : x,
  );
  oneOf(colorSpaceConversion, "default none");
  oneOf(premultiplyAlpha, "default none premultiply");
  const flipY = oneOf(imageOrientation, "from-image flipY none") === "flipY";
  const pixelated = oneOf(resizeQuality, "low pixelated medium high") === "pixelated";
  const [resizeWidth, resizeHeight] = [size.resizeWidth, size.resizeHeight].map(it =>
    it === undefined ? it : enforce(it, 0, 2 ** 32 - 1),
  );
  if (hasPart && !((partWidth | 0) * (partHeight | 0))) throw new RangeError("The crop rect's width or height is 0.");
  if (resizeWidth === 0 || resizeHeight === 0) throw invalidStateError("The resize size is 0.");
  let source: { id?: number; blob?: number };
  let width: number;
  let height: number;
  let decoded = 0;
  if (isBlob(image)) {
    const blob = native.putBlob(await image.bytes());
    const result = await native.request("image.decode", { blob }).then(undefined, () => {
      throw invalidStateError("The source image could not be decoded.");
    });
    source = { id: (decoded = result.id) };
    width = result.width ?? 300;
    height = result.height ?? 150;
  } else if (isImageData(image)) {
    source = { blob: native.putBlob(bytesOf(image)) };
    ({ width, height } = image);
  } else {
    source = { id: image[kImageId] };
    [width, height] = image[kImageSize];
    if (!source.id || !width || !height) throw invalidStateError("The source image is not usable.");
  }
  [x, y, partWidth, partHeight] = hasPart
    ? normalize(x | 0, y | 0, partWidth | 0, partHeight | 0)
    : [0, 0, width, height];
  const toWidth = ceil(resizeWidth ?? (resizeHeight ? (partWidth * resizeHeight) / partHeight : partWidth));
  const toHeight = ceil(resizeHeight ?? (resizeWidth ? (partHeight * resizeWidth) / partWidth : partHeight));
  try {
    if (toWidth * toHeight > MAX_AREA) throw invalidStateError("The ImageBitmap could not be allocated.");
    const part = { x, y, width: partWidth, height: partHeight, toWidth, toHeight, flipY, pixelated };
    const id = snapshot("canvas.bitmap", source, width, height, part);
    return new ImageBitmap(kInternal, id, toWidth, toHeight, !!image[kIsTainted]);
  } finally {
    if (decoded) native.send("image.release", { id: decoded });
  }
}

/** The type that `toBlob` and `toDataURL` produce when they are asked for `type`. */
function encodedType(type: unknown) {
  const lower = String(type).toLowerCase();
  return lower === "image/jpeg" || lower === "image/webp" ? lower : "image/png";
}

class ImageBitmapRenderingContext {
  #context: CanvasRenderingContext2D;

  constructor(key: unknown = undefined, context?: CanvasRenderingContext2D) {
    checkInternal(key);
    this.#context = context!;
  }

  get canvas() {
    return this.#context.canvas;
  }

  transferFromImageBitmap(bitmap: ImageBitmap | null) {
    const context = this.#context;
    need(arguments.length, 1);
    if (bitmap == null) return context[kResize](context.canvas.width, context.canvas.height);
    if (!(bitmap instanceof ImageBitmap)) throw new TypeError("parameter 1 is not of type 'ImageBitmap'.");
    bitmap[kImageId];
    context[kAdopt](bitmap);
  }
}

/** What a `<canvas>` that has given up control does with the pixels. `isOwned`: it has to release the image. */
type Present = (id: number, width: number, height: number, isOwned: boolean) => void;
let createOffscreen: (width: number, height: number, present?: Present, isRemote?: boolean) => OffscreenCanvas;

class OffscreenCanvas extends events.EventTarget {
  #width: number;
  #height: number;
  #type = "";
  #context?: CanvasRenderingContext2D;
  #renderer?: ImageBitmapRenderingContext;
  #isDetached = false;
  #present?: Present;
  #isRemote = false;

  static {
    createOffscreen = (width, height, present, isRemote = false) => {
      const canvas = new OffscreenCanvas(width, height);
      canvas.#present = present;
      canvas.#isRemote = isRemote;
      return canvas;
    };
    transferable(this.prototype, canvas => canvas.#beginTransfer());
  }

  constructor(width: number, height: number) {
    need(arguments.length, 2);
    [width, height] = [enforce(width, 0, 2 ** 53 - 1), enforce(height, 0, 2 ** 53 - 1)];
    super();
    this.#width = width;
    this.#height = height;
  }

  #backing(settings?: unknown): CanvasRenderingContext2D {
    if (this.#context) return this.#context;
    const canvas = this;
    const host = {
      width: this.#width,
      height: this.#height,
      invalidate: this.#present && (() => this.#show()),
      canvas,
    };
    return (this.#context = Reflect.construct(
      CanvasRenderingContext2D,
      [kInternal, host, settings],
      OffscreenCanvasRenderingContext2D,
    ));
  }

  #show() {
    const [width, height] = this.#context![kImageSize];
    const id = this.#context![kImageId];
    if (!this.#isRemote) this.#present!(id, width, height, false);
    else this.#present!(width * height && snapshot("canvas.bitmap", { id }, width, height), width, height, true);
  }

  #requireAttached() {
    if (this.#isDetached) throw invalidStateError("The OffscreenCanvas is detached.");
  }

  #beginTransfer() {
    if (this.#isDetached) throw new DOMException("The OffscreenCanvas is detached.", "DataCloneError");
    if (this.#type !== "")
      throw invalidStateError("An OffscreenCanvas that has a rendering context cannot be transferred.");
    const present = this.#present;
    const channel = present && new MessageChannel();
    return {
      record: { kind: "OffscreenCanvas", width: this.#width, height: this.#height, port: channel?.port2 },
      moved: channel ? [channel.port2] : [],
      detach: () => {
        this.#isDetached = true;
        this.#width = this.#height = 0;
        if (channel) channel.port1.onmessage = ({ data }) => present(data[0], data[1], data[2], true);
      },
    };
  }

  get [kImageId]() {
    this.#requireAttached();
    return this.#backing()[kImageId];
  }

  get [kImageSize]() {
    return this.#context?.[kImageSize] ?? [this.#width, this.#height];
  }

  get [kIsTainted]() {
    return this.#context?.[kIsTainted];
  }

  get width() {
    return this.#width;
  }

  set width(value) {
    value = enforce(value, 0, 2 ** 53 - 1);
    this.#requireAttached();
    this.#resize(value, this.#height);
  }

  get height() {
    return this.#height;
  }

  set height(value) {
    value = enforce(value, 0, 2 ** 53 - 1);
    this.#requireAttached();
    this.#resize(this.#width, value);
  }

  #resize(width: number, height: number) {
    this.#width = width;
    this.#height = height;
    if (this.#context) this.#context[kResize](width, height);
    else this.#present?.(0, width, height, false);
  }

  getContext(type: string, settings: unknown = undefined) {
    type = oneOf(`${type}`, "2d bitmaprenderer webgl webgl2 webgpu");
    this.#requireAttached();
    if (type[0] === "w" || (this.#type || type) !== type) return null;
    if (this.#type === "") this.#context = undefined;
    const context = this.#backing(settings);
    this.#type = type;
    return type === "2d" ? context : (this.#renderer ??= new ImageBitmapRenderingContext(kInternal, context));
  }

  transferToImageBitmap() {
    if (this.#type === "")
      throw invalidStateError("Cannot transfer an ImageBitmap from an OffscreenCanvas with no context");
    const context = this.#context!;
    const [width, height] = context[kImageSize];
    if (width * height === 0 || width * height > MAX_AREA)
      throw new DOMException("ImageBitmap construction failed", "UnknownError");
    const id = snapshot("canvas.bitmap", { id: context[kImageId] }, width, height);
    const bitmap = new ImageBitmap(kInternal, id, width, height, context[kIsTainted]);
    if (this.#renderer) context[kResize](this.#width, this.#height);
    else context[kErase]();
    return bitmap;
  }

  async convertToBlob(options: unknown = undefined) {
    const { quality, type: wanted } = dictionary(options);
    this.#requireAttached();
    const type = encodedType(wanted);
    const bytes = await this.#backing()[kEncode](type, +quality);
    if (bytes !== null) return new Blob([bytes], { type });
    if (this.#width * this.#height === 0) throw indexSizeError("The size of the OffscreenCanvas is zero.");
    throw new DOMException("Encoding of the source image has failed.", "EncodingError");
  }
}
events.defineHandlers(OffscreenCanvas.prototype, ["contextlost", "contextrestored"]);

// ───────────────────────────── structured clone ─────────────────────────────

/** See `internal/desktop/web/messaging`. */
function transferable(prototype: object, begin: (value: any) => object, serialize?: Function) {
  $putByIdDirectPrivate(prototype, "transferrer", begin);
  $putByIdDirectPrivate(prototype, "cloner", (value: any) => {
    const transfer = core.realm.page.host.transfers.get(value);
    if (transfer) return transfer.record;
    if (serialize) return serialize(value);
    throw new DOMException("An object that has to be transferred was not in the list.", "DataCloneError");
  });
}

function requireCloneable(bitmap: ImageBitmap) {
  if (bitmap.width > 0 && !bitmap[kIsTainted]) return;
  throw new DOMException("The ImageBitmap is detached, or not origin-clean.", "DataCloneError");
}

transferable(
  ImageBitmap.prototype,
  bitmap => {
    requireCloneable(bitmap);
    const { width, height } = bitmap;
    return {
      record: { kind: "ImageBitmap", id: bitmap[kImageId], width, height },
      moved: [],
      detach: () => takeId(bitmap),
    };
  },
  (bitmap: ImageBitmap) => {
    requireCloneable(bitmap);
    const { width, height } = bitmap;
    const context = createContext({ width, height });
    context.drawImage(bitmap, 0, 0);
    return { kind: "ImageBitmap", width, height, data: context.getImageData(0, 0, width, height).data };
  },
);
$putByIdDirectPrivate(ImageData.prototype, "cloner", ({ data, width, colorSpace, pixelFormat }: ImageData) => ({
  kind: "ImageData",
  data,
  width,
  settings: { colorSpace, pixelFormat },
}));

function deserialize({ kind, id, data, width, height, port, settings }: any) {
  if (kind === "ImageData") return new ImageData(data, width, undefined, settings);
  if (kind === "OffscreenCanvas") {
    if (port) core.realm.page.host.messaging().hide(port);
    return createOffscreen(width, height, port && ((...frame) => port.postMessage(frame)), true);
  }
  id ??= snapshot("canvas.bitmap", { blob: native.putBlob(new Uint8Array(data.buffer)) }, width, height);
  return new ImageBitmap(kInternal, id, width, height);
}

const interfaces = {
  CanvasGradient,
  CanvasPattern,
  CanvasRenderingContext2D,
  ImageBitmap,
  ImageBitmapRenderingContext,
  ImageData,
  OffscreenCanvas,
  OffscreenCanvasRenderingContext2D,
  Path2D,
  TextMetrics,
};
for (const constructor of Object.values(interfaces)) core.expose(constructor);

export default {
  ...interfaces,
  createContext,
  createImageBitmap,
  createOffscreen,
  createRenderer: (context: CanvasRenderingContext2D) => new ImageBitmapRenderingContext(kInternal, context),
  deserialize,
  encodedType,
  flush,
  hooks,
  kEncode,
  kEncodeSync,
  kImageId,
  kImageSize,
  kIsTainted,
  kResize,
  setNative(value: Native) {
    native = value;
  },
};
