const core = require("internal/desktop/dom/core");
const { accessor, domError, expose } = core;
const { parseTransform } = require("internal/desktop/dom/engine");

function dictionary(value: any): any {
  if (value != null && !$isObject(value)) throw new TypeError("The provided value is not a dictionary.");
  return value ?? {};
}

function implOf(self: any, ctor: Function) {
  if (self?.$impl === undefined || self === ctor.prototype) throw new TypeError("Illegal invocation");
  return self.$impl;
}

function defineAttribute(
  ctor: any,
  name: string,
  read: (impl: any) => unknown,
  write?: (impl: any, value: number) => void,
) {
  const { get, set } = Object.getOwnPropertyDescriptor(
    {
      get [name]() {
        return read(implOf(this, ctor));
      },
      set [name](value: any) {
        write!(implOf(this, ctor), +value);
      },
    },
    name,
  )!;
  accessor(ctor.prototype, name, get as any, write && set);
}

function numbers(ctor: any, names: string[], writable: boolean) {
  for (const name of names) {
    defineAttribute(ctor, name, impl => impl[name], writable ? (impl, value) => (impl[name] = value) : undefined);
  }
}

function rectInit(init: unknown): number[] {
  const { height = 0, width = 0, x = 0, y = 0 } = dictionary(init);
  return [+x, +y, +width, +height];
}

function pointInit(init: unknown): number[] {
  const { w = 1, x = 0, y = 0, z = 0 } = dictionary(init);
  return [+x, +y, +z, +w];
}

class DOMRectReadOnly {
  declare $impl: { x: number; y: number; width: number; height: number };

  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.$impl = { x: +x, y: +y, width: +width, height: +height };
  }
  static fromRect(other: unknown = undefined) {
    return new DOMRectReadOnly(...rectInit(other));
  }
  get x() {
    return this.$impl.x;
  }
  get y() {
    return this.$impl.y;
  }
  get width() {
    return this.$impl.width;
  }
  get height() {
    return this.$impl.height;
  }
  get top() {
    const { y, height } = this.$impl;
    return Math.min(y, y + height);
  }
  get right() {
    const { x, width } = this.$impl;
    return Math.max(x, x + width);
  }
  get bottom() {
    const { y, height } = this.$impl;
    return Math.max(y, y + height);
  }
  get left() {
    const { x, width } = this.$impl;
    return Math.min(x, x + width);
  }
  toJSON() {
    const { top, right, bottom, left } = this;
    return { ...this.$impl, top, right, bottom, left };
  }
}
class DOMRect extends DOMRectReadOnly {
  static fromRect(other: unknown = undefined) {
    return new DOMRect(...rectInit(other));
  }
  get x() {
    return this.$impl.x;
  }
  set x(value) {
    this.$impl.x = +value;
  }
  get y() {
    return this.$impl.y;
  }
  set y(value) {
    this.$impl.y = +value;
  }
  get width() {
    return this.$impl.width;
  }
  set width(value) {
    this.$impl.width = +value;
  }
  get height() {
    return this.$impl.height;
  }
  set height(value) {
    this.$impl.height = +value;
  }
}

const lazyRectList = new core.Interface("DOMRectList", () => {
  const { iterable, kList } = require("internal/desktop/dom/node");
  class DOMRectList {
    constructor() {
      core.illegalConstructor();
    }
    get length() {
      return this[kList].size();
    }
    item(index: number) {
      if (arguments.length === 0) throw new TypeError("1 argument required, but only 0 present.");
      return this[kList].at(index >>> 0) ?? null;
    }
  }
  iterable(DOMRectList, false);
  return expose(DOMRectList);
});

function rectAt(values: number[], at = 0) {
  return new DOMRect(values[at], values[at + 1], values[at + 2], values[at + 3]);
}

function rectList(values: number[]) {
  const rects: DOMRect[] = [];
  for (let i = 0; i < values.length; i += 4) rects.push(rectAt(values, i));
  return require("internal/desktop/dom/node").makeList(lazyRectList.load(), {
    size: () => rects.length,
    at: index => rects[index],
  });
}

class DOMPointReadOnly {
  declare $impl: { x: number; y: number; z: number; w: number };

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.$impl = { x: +x, y: +y, z: +z, w: +w };
  }
  static fromPoint(other: unknown = undefined) {
    return new DOMPointReadOnly(...pointInit(other));
  }
  matrixTransform(matrix: unknown = undefined) {
    return DOMMatrix.fromMatrix(matrix).transformPoint(this.$impl);
  }
  toJSON() {
    return { ...implOf(this, Object) };
  }
}
class DOMPoint extends DOMPointReadOnly {
  static fromPoint(other: unknown = undefined) {
    return new DOMPoint(...pointInit(other));
  }
}
numbers(DOMPointReadOnly, ["x", "y", "z", "w"], false);
numbers(DOMPoint, ["x", "y", "z", "w"], true);

class DOMQuad {
  declare $impl: { p1: DOMPoint; p2: DOMPoint; p3: DOMPoint; p4: DOMPoint };

  constructor(...points: any[]) {
    const [p1, p2, p3, p4] = [0, 1, 2, 3].map(index => DOMPoint.fromPoint(points[index]));
    this.$impl = { p1, p2, p3, p4 };
  }
  static fromRect(other: unknown = undefined) {
    const [x, y, width, height] = rectInit(other);
    return new DOMQuad({ x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height });
  }
  static fromQuad(other: unknown = undefined) {
    const { p1, p2, p3, p4 } = dictionary(other);
    return new DOMQuad(p1, p2, p3, p4);
  }
  getBounds() {
    const points: any[] = Object.values(this.$impl);
    const [xs, ys] = [points.map(it => it.x), points.map(it => it.y)];
    const [x, y] = [Math.min(...xs), Math.min(...ys)];
    return new DOMRect(x, y, Math.max(...xs) - x, Math.max(...ys) - y);
  }
  toJSON() {
    return { ...implOf(this, Object) };
  }
}
numbers(DOMQuad, ["p1", "p2", "p3", "p4"], false);

/** m11, m12, m13, m14, m21 and so on. */
type Matrix = number[];
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const names = [1, 2, 3, 4].flatMap(column => [1, 2, 3, 4].map(row => `m${column}${row}`));
const flat = { a: 0, b: 1, c: 4, d: 5, e: 12, f: 13 };
const radians = (degrees: number) => (degrees * Math.PI) / 180;

function from2d([a, b, c, d, e, f]: number[]): Matrix {
  return [a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1];
}

function multiply(a: Matrix, b: Matrix): Matrix {
  return a.map((_, index) => {
    const column = index & 12;
    const row = index & 3;
    return a[row] * b[column] + a[4 + row] * b[column + 1] + a[8 + row] * b[column + 2] + a[12 + row] * b[column + 3];
  });
}

function invert(matrix: Matrix, is2D: boolean): Matrix | null {
  if (!matrix.every(Number.isFinite)) return null;
  if (is2D) {
    const [a, b, c, d, e, f] = Object.values(flat).map(at => matrix[at]);
    const det = a * d - b * c;
    return det ? from2d([d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]) : null;
  }
  const rows = [0, 4, 8, 12].map(at => [...matrix.slice(at, at + 4), ...identity().slice(at, at + 4)]);
  for (let i = 0; i < 4; i++) {
    let pivot = i;
    for (let j = i + 1; j < 4; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    if (!rows[pivot][i]) return null;
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    const scale = rows[i][i];
    rows[i] = rows[i].map(value => value / scale);
    for (let j = 0; j < 4; j++) {
      const factor = rows[j][i];
      if (j !== i) rows[j] = rows[j].map((value, k) => value - factor * rows[i][k]);
    }
  }
  return rows.flatMap(row => row.slice(4));
}

function rotation(x: number, y: number, z: number, degrees: number): Matrix {
  const length = Math.hypot(x, y, z);
  if (length === 0) return identity();
  [x, y, z] = [x / length, y / length, z / length];
  const quarters = (((degrees / 90) % 4) + 4) % 4;
  const s = [0, 1, 0, -1][quarters] ?? Math.sin(radians(degrees));
  const c = [1, 0, -1, 0][quarters] ?? Math.cos(radians(degrees));
  const t = 1 - c;
  return [
    t * x * x + c,
    t * x * y + s * z,
    t * x * z - s * y,
    0,
    t * x * y - s * z,
    t * y * y + c,
    t * y * z + s * x,
    0,
    t * x * z + s * y,
    t * y * z - s * x,
    t * z * z + c,
    0,
    0,
    0,
    0,
    1,
  ];
}

type Impl = { m: Matrix; is2D: boolean };

function fromSequence(values: number[]): Impl {
  if (values.length === 6) return { m: from2d(values), is2D: true };
  if (values.length === 16) return { m: values, is2D: false };
  throw new TypeError("The sequence must contain 6 elements for a 2D matrix or 16 elements for a 3D matrix.");
}

const isInWindow = () => core.realm.page?.window.document !== undefined;

function parseMatrix(text: string): Impl {
  if (!isInWindow()) throw new TypeError("DOMMatrix can't be constructed with strings on workers.");
  if (text === "" || /^\s*none\s*$/i.test(text)) return { m: identity(), is2D: true };
  const values = Array.from<number>(relativeLength.test(text) ? [] : parseTransform(text));
  if (values.length === 0) throw domError("SyntaxError", `Failed to parse '${text}'.`);
  if (/calc|min|max|clamp|[/][*]/i.test(text)) return fromSequence(values);
  const matrix = new DOMMatrix();
  for (const [, name, list] of text.toLowerCase().matchAll(/([\w]+)\(([^)]*)\)/g)) {
    const [x, y, z, angle] = list.split(",").map(toNumber);
    const [, kind, axis] = /^(matrix|perspective|rotate|scale|skew|translate)(.*)/.exec(name)!;
    const along = (neutral: number) => ["x", "y", "z"].map(it => (it === axis ? x : neutral));
    const isAlongAxis = axis.length === 1;
    if (kind === "matrix") matrix.multiplySelf(new DOMMatrix(list.split(",").map(toNumber)));
    else if (kind === "translate") matrix.translateSelf(...(isAlongAxis ? along(0) : [x, y, z]));
    else if (kind === "scale") matrix.scaleSelf(...(isAlongAxis ? along(1) : [x, y, z]));
    else if (kind === "skew")
      then(matrix, from2d([1, tan(axis === "y" ? x : (y ?? 0)), tan(axis === "y" ? 0 : x), 1, 0, 0]), true);
    else if (kind === "perspective") then(matrix, identity().with(11, x === x ? -1 / Math.max(x, 1) : 0), false);
    else if (axis === "3d") matrix.rotateAxisAngleSelf(x, y, z, angle);
    else matrix.rotateAxisAngleSelf(+(axis === "x"), +(axis === "y"), +(axis === "z" || axis === ""), x);
    if (axis === "3d" || axis === "z" || (kind === "rotate" && isAlongAxis)) matrix.$impl.is2D = false;
  }
  return matrix.$impl;
}

const relativeLength = /\d(?:r?(?:em|ex|ch|ic|cap|lh)|[sld]?v(?:w|h|i|b|min|max)|cq\w+)|translate[^)]*%/i;
const units = {
  __proto__: null,
  "%": 0.01,
  cm: 96 / 2.54,
  grad: 0.9,
  in: 96,
  mm: 96 / 25.4,
  pc: 16,
  pt: 4 / 3,
  q: 96 / 101.6,
  rad: 180 / Math.PI,
  turn: 360,
};
/** In pixels or degrees. */
const toNumber = (text: string) => parseFloat(text) * (units[/[a-z%]*$/.exec(text.trim())![0]] ?? 1);
const tan = (degrees: number) => Math.tan(radians(degrees));

/** https://drafts.fxtf.org/geometry/#dommatrixinit-validate-and-fixup. The last item says whether it is 2D. */
function fixMatrix(init: unknown, isFlat = false): number[] {
  const given = dictionary(init);
  const m = identity();
  for (const name in flat) {
    const [short, long] = [given[name], given[names[flat[name]]]].map(it => (it === undefined ? it : +it));
    if (short !== undefined && long !== undefined && ![short].includes(long)) {
      throw new TypeError(`${name} and ${names[flat[name]]} have to be the same.`);
    }
    m[flat[name]] = long ?? short ?? m[flat[name]];
  }
  if (isFlat) return m;
  let looks2D = true;
  for (const index of [2, 3, 6, 7, 8, 9, 10, 11, 14, 15]) {
    const value = given[names[index]];
    if (value === undefined) continue;
    if (+value !== m[index]) looks2D = false;
    m[index] = +value;
  }
  if (given.is2D && !looks2D)
    throw new TypeError("The is2D member is set to true but the input matrix is a 3d matrix.");
  const is2D = given.is2D === undefined ? looks2D : !!given.is2D;
  return [...(is2D ? from2d(Object.values(flat).map(at => m[at])) : m), +is2D];
}

function create<T extends DOMMatrixReadOnly>(ctor: new () => T, impl: Impl): T {
  const made = new ctor();
  made.$impl.m = impl.m;
  made.$impl.is2D = impl.is2D;
  return made;
}

function fromInit(init: unknown): Impl {
  const m = fixMatrix(init);
  return { is2D: m.pop() === 1, m };
}

function fromArray(values: any, isRightType: (value: unknown) => boolean): Impl {
  if (!isRightType(values)) throw new TypeError("parameter 1 is not of the right type.");
  return fromSequence(Array.from(values));
}

const types = () => require("node:util/types");
const copyOf = (self: any) => create(DOMMatrix, { m: [...implOf(self, Object).m], is2D: self.$impl.is2D });

class DOMMatrixReadOnly {
  declare $impl: Impl;

  constructor(init: any = undefined) {
    if (init === undefined) this.$impl = { m: identity(), is2D: true };
    else if ($isObject(init) && init[Symbol.iterator])
      this.$impl = fromSequence(Array.from(init as any, (value: any) => +value));
    else this.$impl = parseMatrix(`${init}`);
  }
  static fromMatrix(other: unknown = undefined) {
    return create(DOMMatrixReadOnly, fromInit(other));
  }
  static fromFloat32Array(values: Float32Array) {
    return create(DOMMatrixReadOnly, fromArray(values, types().isFloat32Array));
  }
  static fromFloat64Array(values: Float64Array) {
    return create(DOMMatrixReadOnly, fromArray(values, types().isFloat64Array));
  }
  get is2D() {
    return this.$impl.is2D;
  }
  get isIdentity() {
    return identity().every((value, index) => value === this.$impl.m[index]);
  }
  flipX() {
    return copyOf(this).scaleSelf(-1, 1);
  }
  flipY() {
    return copyOf(this).scaleSelf(1, -1);
  }
  scaleNonUniform(x = 1, y = 1) {
    return copyOf(this).scaleSelf(x, y);
  }
  transformPoint(point: unknown = undefined) {
    const { m } = this.$impl;
    const [x, y, z, w] = pointInit(point);
    const row = (at: number) => m[at] * x + m[4 + at] * y + m[8 + at] * z + m[12 + at] * w;
    return new DOMPoint(row(0), row(1), row(2), row(3));
  }
  toFloat32Array() {
    return new Float32Array(this.$impl.m);
  }
  toFloat64Array() {
    return new Float64Array(this.$impl.m);
  }
  toJSON() {
    const keys = [...Object.keys(flat), ...names, "is2D", "isIdentity"];
    const read = (key: string) => Reflect.get(DOMMatrixReadOnly.prototype, key, this);
    return Object.fromEntries(keys.map(key => [key, read(key)]));
  }
  toString() {
    const { m, is2D } = this.$impl;
    if (!m.every(Number.isFinite)) throw domError("InvalidStateError", "The matrix has a value that is not finite.");
    const values = is2D ? Object.values(flat).map(at => m[at]) : m;
    return `${is2D ? "matrix" : "matrix3d"}(${values.join(", ")})`;
  }
}

function then(self: any, other: Matrix, is2D: boolean) {
  self.$impl.m = multiply(self.$impl.m, other);
  self.$impl.is2D &&= is2D;
  return self;
}

class DOMMatrix extends DOMMatrixReadOnly {
  static fromMatrix(other: unknown = undefined) {
    return create(DOMMatrix, fromInit(other));
  }
  static fromFloat32Array(values: Float32Array) {
    return create(DOMMatrix, fromArray(values, types().isFloat32Array));
  }
  static fromFloat64Array(values: Float64Array) {
    return create(DOMMatrix, fromArray(values, types().isFloat64Array));
  }
  multiplySelf(other: unknown = undefined) {
    const { m, is2D } = fromInit(other);
    return then(this, m, is2D);
  }
  preMultiplySelf(other: unknown = undefined) {
    const { m, is2D } = fromInit(other);
    this.$impl.m = multiply(m, this.$impl.m);
    this.$impl.is2D &&= is2D;
    return this;
  }
  translateSelf(x = 0, y = 0, z = 0) {
    return then(this, [...identity().slice(0, 12), +x, +y, +z, 1], +z === 0);
  }
  scaleSelf(x = 1, y = x, z = 1, originX = 0, originY = 0, originZ = 0) {
    this.translateSelf(originX, originY, originZ);
    then(this, [+x, 0, 0, 0, 0, +y, 0, 0, 0, 0, +z, 0, 0, 0, 0, 1], +z === 1);
    return this.translateSelf(-originX, -originY, -originZ);
  }
  scale3dSelf(scale = 1, originX = 0, originY = 0, originZ = 0) {
    return this.scaleSelf(scale, scale, scale, originX, originY, originZ);
  }
  rotateSelf(x = 0, y: any = undefined, z: any = undefined) {
    if (y === undefined && z === undefined) [x, y, z] = [0, 0, x];
    then(this, rotation(0, 0, 1, z ?? 0), true);
    then(this, rotation(0, 1, 0, y ?? 0), !y);
    return then(this, rotation(1, 0, 0, x), !x);
  }
  rotateFromVectorSelf(x = 0, y = 0) {
    return then(this, rotation(0, 0, 1, +x === 0 && +y === 0 ? 0 : (Math.atan2(y, x) * 180) / Math.PI), true);
  }
  rotateAxisAngleSelf(x = 0, y = 0, z = 0, angle = 0) {
    return then(this, rotation(x, y, z, angle), x === 0 && y === 0);
  }
  skewXSelf(angle = 0) {
    return then(this, from2d([1, 0, Math.tan(radians(angle)), 1, 0, 0]), true);
  }
  skewYSelf(angle = 0) {
    return then(this, from2d([1, Math.tan(radians(angle)), 0, 1, 0, 0]), true);
  }
  invertSelf() {
    const inverse = invert(this.$impl.m, this.$impl.is2D);
    this.$impl.m = inverse ?? identity().fill(NaN);
    this.$impl.is2D &&= inverse !== null;
    return this;
  }
  setMatrixValue(transform: string) {
    if (arguments.length === 0) throw new TypeError("1 argument required, but only 0 present.");
    Object.assign(this.$impl, parseMatrix(`${transform}`));
    return this;
  }
}

for (const name of [
  "multiply",
  "translate",
  "scale",
  "scale3d",
  "rotate",
  "rotateFromVector",
  "rotateAxisAngle",
  "skewX",
  "skewY",
  "inverse",
]) {
  const method = DOMMatrix.prototype[name === "inverse" ? "invertSelf" : name + "Self"];
  const holder = {
    [name](...args: unknown[]) {
      return method.$apply(copyOf(this), args);
    },
  };
  Object.assign(DOMMatrixReadOnly.prototype, holder);
}
for (const [name, index] of [...Object.entries(flat), ...names.map((name, index) => [name, index] as const)]) {
  const read = (impl: Impl) => impl.m[index];
  defineAttribute(DOMMatrixReadOnly, name, read);
  defineAttribute(DOMMatrix, name, read, (impl: Impl, value) => {
    impl.m[index] = value;
    if (!Object.values(flat).includes(index) && value !== identity()[index]) impl.is2D = false;
  });
}

const interfaces = { DOMMatrix, DOMMatrixReadOnly, DOMPoint, DOMPointReadOnly, DOMQuad, DOMRect, DOMRectReadOnly };
for (const ctor of Object.values<any>(interfaces)) {
  expose(ctor);
  for (const name of Object.getOwnPropertyNames(ctor)) {
    if (name.startsWith("from")) Object.defineProperty(ctor, name, { enumerable: true });
  }
  $putByIdDirectPrivate(ctor.prototype, "cloner", (value: any) => ({
    kind: ctor.name,
    values: ctor === DOMQuad ? Object.values<any>(value.$impl).map(point => point.$impl) : value.$impl,
  }));
}

function deserialize({ kind, values }: any) {
  if (kind === "DOMQuad") return new DOMQuad(...values);
  const made = new interfaces[kind]();
  Object.assign(made.$impl, values);
  return made;
}

/** What only windows have. */
function removeStrings() {
  delete (DOMMatrixReadOnly.prototype as any).toString;
  delete (DOMMatrix.prototype as any).setMatrixValue;
}

export default { ...interfaces, deserialize, fixMatrix, rectAt, rectList, removeStrings };
