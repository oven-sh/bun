// CSS Typed OM.
const core = require("internal/desktop/dom/core");
const engine = require("internal/desktop/dom/engine");
const { escape, propertyNamed } = require("internal/desktop/dom/cssom");
const { DOMMatrix } = require("internal/desktop/dom/geometry");
const { iterable, setIndexes } = require("internal/desktop/dom/node");

const { accessor, asciiLower, domError, expose, illegalConstructor, splitTokens } = core;

function finite(value: unknown): number {
  const number = +(value as number);
  if (!Number.isFinite(number)) throw new TypeError("The provided double value is non-finite.");
  return number;
}

function formatNumber(value: number): string {
  const [digits, exponent] = value.toExponential(5).split("e");
  if (+exponent >= -5 && +exponent < 6) return String(+value.toPrecision(6));
  if (Number.isInteger(value) && Math.abs(value) < 2 ** 31) return String(value);
  return `${+digits}e${exponent[0]}${exponent.slice(1).padStart(2, "0")}`;
}

/** What has no other class. */
class Plain {
  property: string;
  text: string;

  constructor(property: string, text: string) {
    this.property = property;
    this.text = text;
  }
}

class CSSStyleValue {
  declare $impl: any;

  constructor() {
    if (new.target === CSSStyleValue) illegalConstructor();
  }
  static parse(property: string, cssText: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    return parseValues(validProperty(property), `${cssText}`)[0];
  }
  static parseAll(property: string, cssText: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    return parseValues(validProperty(property), `${cssText}`);
  }
  toString(): string {
    return serialize(this, false);
  }
}
class CSSImageValue extends CSSStyleValue {
  constructor() {
    super();
    illegalConstructor();
  }
}

function make(ctor: any, impl: unknown) {
  const made = Object.create(ctor.prototype);
  $putByIdDirectPrivate(made, "impl", impl);
  return made;
}

/** Accessors for the members of `$impl`. */
function members(ctor: any, names: string[], convert?: (value: any, name: string, self: any) => unknown) {
  for (const name of names) {
    accessor(
      ctor.prototype,
      name,
      function (this: any) {
        return this.$impl[name];
      },
      convert &&
        function (this: any, value) {
          this.$impl[name] = convert(value, name, this);
        },
    );
  }
}

function notEmpty(value: unknown): string {
  if (`${value}` === "") throw new TypeError("CSSKeywordValue does not support empty strings");
  return `${value}`;
}
class CSSKeywordValue extends CSSStyleValue {
  constructor(value: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = { value: notEmpty(value) };
  }
}
members(CSSKeywordValue, ["value"], notEmpty);

/** With indexes that can be set, up to the one after the last. */
function indexed(target: any, convert: (value: unknown) => unknown) {
  const list: unknown[] = target.$impl;
  const isIndex = (key: string | symbol) => typeof key === "string" && String(+key >>> 0) === key;
  const has = (key: string | symbol) => isIndex(key) && +(key as string) < list.length;
  return new Proxy(target, {
    get: (_, key, receiver) => (isIndex(key) ? list[key] : Reflect.get(target, key, receiver)),
    has: (_, key) => has(key) || key in target,
    ownKeys: () => [...Object.keys(list), ...Reflect.ownKeys(target)],
    getOwnPropertyDescriptor: (_, key) =>
      has(key)
        ? { value: list[key], writable: true, enumerable: true, configurable: true }
        : Reflect.getOwnPropertyDescriptor(target, key),
    set(_, key, value, receiver) {
      if (!isIndex(key)) return Reflect.set(target, key, value, receiver);
      if (+(key as string) > list.length) throw new RangeError("The index provided is outside the range.");
      list[key] = convert(value);
      return true;
    },
  });
}

const segment = (value: unknown) => (value instanceof CSSVariableReferenceValue ? value : `${value}`);
class CSSUnparsedValue extends CSSStyleValue {
  constructor(members: Iterable<unknown>) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = Array.from(sequence(members), segment);
    return indexed(this, segment);
  }
  get length() {
    return this.$impl.length;
  }
}
iterable(CSSUnparsedValue, true);

function sequence(value: any): Iterable<any> {
  if (!$isObject(value) || value[Symbol.iterator] == null)
    throw new TypeError("The value cannot be converted to a sequence.");
  return value as any;
}

function variableName(value: unknown): string {
  if (!`${value}`.startsWith("--")) throw new TypeError("Invalid custom property name");
  return `${value}`;
}
class CSSVariableReferenceValue {
  declare $impl: { variable: string; fallback: CSSUnparsedValue | null };

  constructor(variable: string, fallback: CSSUnparsedValue | null = null) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (fallback !== null && !(fallback instanceof CSSUnparsedValue))
      throw new TypeError("The fallback is not a CSSUnparsedValue.");
    this.$impl = { variable: variableName(variable), fallback };
  }
}
members(CSSVariableReferenceValue, ["variable"], variableName);
members(CSSVariableReferenceValue, ["fallback"]);

function unparsedText(value: CSSUnparsedValue, outer: object[]): string {
  if (outer.includes(value.$impl)) return "";
  const parts = value.$impl.map(it => {
    if (typeof it === "string") return it;
    const { variable, fallback } = it.$impl;
    return `var(${variable}${fallback === null ? "" : "," + unparsedText(fallback, [...outer, value.$impl])})`;
  });
  return parts.reduce(
    (all, it, i) =>
      all +
      (i > 0 &&
      typeof value.$impl[i - 1] === "string" &&
      (typeof value.$impl[i] === "string" || /[\w\-@#\u0080-\uffff]$/.test(all))
        ? "/**/"
        : "") +
      it,
    "",
  );
}

function parseUnparsed(text: string): CSSUnparsedValue {
  const parts: string[] = engine.splitVariables(text);
  const all: unknown[] = [];
  for (let i = 0; i < parts.length; i += 3) {
    if (parts[i] !== "") all.push(parts[i]);
    if (parts[i + 1] === "") continue;
    all.push(new CSSVariableReferenceValue(parts[i + 1], parts[i + 2] === "\0" ? null : parseUnparsed(parts[i + 2])));
  }
  return new CSSUnparsedValue(all);
}

// ───────────────────────────── numbers ─────────────────────────────

const baseTypes = splitTokens("length angle time frequency resolution flex percent");
const viewportUnits = ["", "s", "l", "d"].flatMap(size =>
  splitTokens("vw vh vi vb vmin vmax").map(unit => size + unit),
);
const unitsByType = {
  length: [
    ...splitTokens("em rem ex rex cap rcap ch rch ic ric lh rlh cqw cqh cqi cqb cqmin cqmax cm mm q in pt pc px"),
    ...viewportUnits,
  ],
  angle: splitTokens("deg grad rad turn"),
  time: splitTokens("s ms"),
  frequency: splitTokens("hz khz"),
  resolution: splitTokens("dpi dpcm dppx x"),
  flex: ["fr"],
  percent: ["percent"],
  "": ["number"],
};
const typeOfUnit = new Map<string, string>();
for (const type in unitsByType) for (const unit of unitsByType[type]) typeOfUnit.$set(unit, type);
const canonicalUnits = { __proto__: null, length: "px", angle: "deg", time: "s", frequency: "hz", resolution: "dppx" };
/** In the canonical unit. */
const ratios = {
  __proto__: null,
  px: 1,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  in: 96,
  pt: 96 / 72,
  pc: 16,
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
  s: 1,
  ms: 0.001,
  hz: 1,
  khz: 1000,
  dppx: 1,
  x: 1,
  dpi: 1 / 96,
  dpcm: 2.54 / 96,
};
const canonicalOf = (unit: string): string => (unit in ratios ? canonicalUnits[typeOfUnit.$get(unit)!] : unit);

function validUnit(unit: unknown): string | null {
  const lower = asciiLower(`${unit}`);
  return lower === "%" ? "percent" : typeOfUnit.$has(lower) ? lower : null;
}

class Type {
  /** For each of `baseTypes`. */
  powers = [0, 0, 0, 0, 0, 0, 0];
  percentHint = -1;

  static of(unit: string): Type {
    const type = new Type();
    if (unit !== "number") type.powers[baseTypes.indexOf(typeOfUnit.$get(unit) as any)] = 1;
    return type;
  }
  hinted(hint: number): Type {
    const type = new Type();
    type.powers = this.powers.slice();
    type.percentHint = hint;
    if (hint < 0) return type;
    type.powers[hint] += type.powers[6];
    type.powers[6] = 0;
    return type;
  }
  /** With the same hint. */
  static align(a: Type, b: Type): [Type, Type] | null {
    if (a.percentHint >= 0 && b.percentHint >= 0 && a.percentHint !== b.percentHint) return null;
    const hint = Math.max(a.percentHint, b.percentHint);
    return [a.hinted(hint), b.hinted(hint)];
  }
  add(other: Type): Type | null {
    const both = Type.align(this, other);
    if (both === null) return null;
    const [a, b] = both;
    if (String(a.powers) === String(b.powers)) return a;
    if (a.powers[6] === 0 && b.powers[6] === 0) return null;
    for (let hint = 0; hint < 6; hint++) {
      if ((a.powers[hint] || b.powers[hint]) && String(a.hinted(hint).powers) === String(b.hinted(hint).powers))
        return a.hinted(hint);
    }
    return null;
  }
  multiply(other: Type): Type | null {
    const both = Type.align(this, other);
    both?.[1].powers.forEach((power, index) => (both[0].powers[index] += power));
    return both && both[0];
  }
  inverted(): Type {
    const type = this.hinted(this.percentHint);
    type.powers = type.powers.map(it => 0 - it);
    return type;
  }
  /** "" for a number. */
  matches(base: string, orPercent = false): boolean {
    const at = baseTypes.indexOf(base);
    const only = (index: number) => this.powers.every((power, i) => power === +(i === index));
    return (only(at) && (this.percentHint < 0 || orPercent)) || (orPercent && only(6));
  }
}

const rectify = (value: unknown): CSSNumericValue =>
  value instanceof CSSNumericValue ? value : unitValue(finite(value), "number");
const typeOf = (value: CSSNumericValue): Type => value.$impl.type;
const isUnit = (value: unknown, unit?: string) =>
  value instanceof CSSUnitValue && (unit === undefined || value.$impl.unit === unit);
const unitValue = (value: number, unit: string): CSSUnitValue =>
  make(CSSUnitValue, { value, unit, type: Type.of(unit) });

function negate(it: CSSNumericValue): CSSNumericValue {
  if (it instanceof CSSMathNegate) return it.$impl.value;
  return isUnit(it) ? unitValue(-it.$impl.value, it.$impl.unit) : new CSSMathNegate(it);
}

function invert(it: CSSNumericValue): CSSNumericValue {
  if (it instanceof CSSMathInvert) return it.$impl.value;
  if (!isUnit(it, "number")) return new CSSMathInvert(it);
  if (it.$impl.value === 0) throw new RangeError("Can't divide-by-zero");
  return unitValue(1 / it.$impl.value, "number");
}

function combine(self: CSSNumericValue, ctor: any, values: CSSNumericValue[], fold: (a: number, b: number) => number) {
  const all = [...(self instanceof ctor ? self.$impl.list : [self]), ...values];
  if (!all.every(it => isUnit(it, all[0].$impl.unit ?? ""))) return new ctor(...all);
  return unitValue(
    all.map(it => it.$impl.value).reduce((a, b) => fold(a, b)),
    all[0].$impl.unit,
  );
}

function multiply(self: CSSNumericValue, values: CSSNumericValue[]): any {
  const all = [...(self instanceof CSSMathProduct ? self.$impl.list : [self]), ...values];
  const others = all.filter(it => !isUnit(it, "number"));
  if (others.length > 1 || (others.length === 1 && !isUnit(others[0]))) return new CSSMathProduct(...all);
  return unitValue(
    all.reduce((product, it) => product * it.$impl.value, 1),
    others[0]?.$impl.unit ?? "number",
  );
}

function equal(a: CSSNumericValue, b: CSSNumericValue): boolean {
  const [x, y] = [a.$impl, b.$impl];
  if (isUnit(a) || isUnit(b)) return x.unit === y.unit && x.value === y.value;
  return (
    x.operator === y.operator &&
    x.list.length === y.list.length &&
    x.list.every((it, index) => equal(it, y.list[index]))
  );
}

/** A number, and the power of each of its units. */
type Term = [number, Record<string, number>];
const keyOf = (term: Term) => String(Object.entries(term[1]).sort());
const typeOfTerm = ([, units]: Term) => {
  const type = new Type();
  for (const unit in units) type.powers[baseTypes.indexOf(typeOfUnit.$get(unit) as any)] += units[unit];
  return type;
};

function sumValue(it: CSSNumericValue): Term[] | null {
  const { operator, value, unit, list } = it.$impl;
  if (operator === undefined)
    return [[value * (ratios[unit] ?? 1), unit === "number" ? {} : { [canonicalOf(unit)]: 1 }]];
  const parts: Term[][] = list.map(sumValue);
  if (parts.includes(null!)) return null;
  if (operator === "negate") return parts[0].map(([number, units]) => [-number, units]);
  if (operator === "sum") {
    const all = new Map<string, Term>();
    for (const term of parts.flat()) all.$set(keyOf(term), [term[0] + (all.$get(keyOf(term))?.[0] ?? 0), term[1]]);
    const terms = Array.from(all.values());
    return terms.map(typeOfTerm).reduce((a, b) => a && a.add(b)!) === null ? null : terms;
  }
  if (operator === "product") {
    return parts.reduce((all, part) =>
      all.flatMap(([a, left]) =>
        part.map(([b, right]): Term => {
          const units = { ...left };
          for (const unit in right) if ((units[unit] = (units[unit] ?? 0) + right[unit]) === 0) delete units[unit];
          return [a * b, units];
        }),
      ),
    );
  }
  if (parts.some(part => part.length !== 1 || keyOf(part[0]) !== keyOf(parts[0][0]))) return null;
  const [[[first, units]]] = parts;
  if (operator === "invert")
    return [[1 / first, Object.fromEntries(Object.entries(units).map(([unit, power]) => [unit, -power]))]];
  const numbers = parts.map(part => part[0][0]);
  if (operator === "clamp") return [[Math.max(first, Math.min(numbers[1], numbers[2])), units]];
  return [[operator === "min" ? Math.min(...numbers) : Math.max(...numbers), units]];
}

function fromTerm([value, units]: Term): CSSUnitValue | null {
  const names = Object.keys(units);
  if (names.length === 0) return unitValue(value, "number");
  return names.length === 1 && units[names[0]] === 1 ? unitValue(value, names[0]) : null;
}

function convert(it: CSSUnitValue | null, unit: string): CSSUnitValue | null {
  if (it === null || canonicalOf(it.$impl.unit) !== canonicalOf(unit)) return null;
  return unitValue((it.$impl.value * (ratios[it.$impl.unit] ?? 1)) / (ratios[unit] ?? 1), unit);
}

function unitOrThrow(unit: unknown): string {
  const valid = validUnit(unit);
  if (valid === null) throw domError("SyntaxError", "Invalid unit for conversion");
  return valid;
}

class CSSNumericValue extends CSSStyleValue {
  constructor() {
    if (new.target === CSSNumericValue) illegalConstructor();
    super();
  }
  static parse(cssText: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const parsed = parseNumeric(`${cssText}`);
    if (parsed === null) throw domError("SyntaxError", "Invalid math expression");
    return parsed;
  }
  add(...values: unknown[]) {
    return combine(this, CSSMathSum, values.map(rectify), (a, b) => a + b);
  }
  sub(...values: unknown[]) {
    return combine(this, CSSMathSum, values.map(rectify).map(negate), (a, b) => a + b);
  }
  mul(...values: unknown[]): any {
    return multiply(this, values.map(rectify));
  }
  div(...values: unknown[]): any {
    return multiply(this, values.map(rectify).map(invert));
  }
  min(...values: unknown[]) {
    return combine(this, CSSMathMin, values.map(rectify), Math.min);
  }
  max(...values: unknown[]) {
    return combine(this, CSSMathMax, values.map(rectify), Math.max);
  }
  equals(...values: unknown[]) {
    return values.map(rectify).every(it => equal(this, it));
  }
  to(unit: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    const wanted = unitOrThrow(unit);
    const sum = isUnit(this) ? null : sumValue(this);
    const converted = convert(isUnit(this) ? (this as any) : sum?.length === 1 ? fromTerm(sum[0]) : null, wanted);
    if (converted === null) throw new TypeError("Cannot convert to " + unit);
    return converted;
  }
  toSum(...units: unknown[]) {
    const wanted = units.map(unitOrThrow);
    let values = sumValue(this)?.map(fromTerm);
    if (values === undefined || values.includes(null)) throw new TypeError("Invalid value for conversion");
    if (wanted.length === 0) return new CSSMathSum(...values.sort((a, b) => (a!.$impl.unit < b!.$impl.unit ? -1 : 1)));
    const result = wanted.map(unit => {
      const total = values!.reduce((sum, it) => sum + (convert(it, unit)?.$impl.value ?? 0), 0);
      values = values!.filter(it => convert(it, unit) === null);
      return unitValue(total, unit);
    });
    if (values.length > 0) throw new TypeError("There were leftover terms that were not converted");
    return new CSSMathSum(...result);
  }
  type() {
    const { powers, percentHint } = typeOf(this);
    const type = Object.fromEntries(baseTypes.map((name, index) => [name, powers[index]]).filter(it => it[1] !== 0));
    if (percentHint >= 0) type.percentHint = baseTypes[percentHint];
    return type;
  }
}

class CSSUnitValue extends CSSNumericValue {
  constructor(value: number, unit: string) {
    if ($argumentCount() < 2) core.tooFew(2);
    super();
    const number = finite(value);
    const valid = validUnit(unit);
    if (valid === null) throw new TypeError("Invalid unit: " + unit);
    this.$impl = { value: number, unit: valid, type: Type.of(valid) };
  }
}
members(CSSUnitValue, ["value"], finite);
members(CSSUnitValue, ["unit"]);

class CSSNumericArray {
  declare $impl: CSSNumericValue[];

  constructor() {
    illegalConstructor();
  }
  get length() {
    return this.$impl.length;
  }
}
iterable(CSSNumericArray, true);

class CSSMathValue extends CSSNumericValue {
  constructor() {
    if (new.target === CSSMathValue) illegalConstructor();
    super();
  }
}
members(CSSMathValue, ["operator"]);

function operation(operator: string, args: unknown[]) {
  const list = args.map(rectify);
  if (list.length === 0) throw domError("SyntaxError", "Arguments can't be empty");
  const type = list.map(typeOf).reduce((a, b) => a && (operator === "product" ? a.multiply(b) : a.add(b))!);
  if (type === null) throw new TypeError("Incompatible types");
  const values = make(CSSNumericArray, list);
  setIndexes(values, list);
  return { operator, list, values, type, value: list[operator === "clamp" ? 1 : 0], lower: list[0], upper: list[2] };
}
class CSSMathSum extends CSSMathValue {
  constructor(...args: unknown[]) {
    super();
    this.$impl = operation("sum", args);
  }
}
class CSSMathProduct extends CSSMathValue {
  constructor(...args: unknown[]) {
    super();
    this.$impl = operation("product", args);
  }
}
class CSSMathMin extends CSSMathValue {
  constructor(...args: unknown[]) {
    super();
    this.$impl = operation("min", args);
  }
}
class CSSMathMax extends CSSMathValue {
  constructor(...args: unknown[]) {
    super();
    this.$impl = operation("max", args);
  }
}
class CSSMathClamp extends CSSMathValue {
  constructor(lower: unknown, value: unknown, upper: unknown) {
    if ($argumentCount() < 3) core.tooFew(3);
    super();
    this.$impl = operation("clamp", [lower, value, upper]);
  }
}
class CSSMathNegate extends CSSMathValue {
  constructor(arg: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = operation("negate", [arg]);
  }
}
class CSSMathInvert extends CSSMathValue {
  constructor(arg: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = operation("invert", [arg]);
    this.$impl.type = this.$impl.type.inverted();
  }
}
for (const ctor of [CSSMathSum, CSSMathProduct, CSSMathMin, CSSMathMax]) members(ctor, ["values"]);
for (const ctor of [CSSMathNegate, CSSMathInvert]) members(ctor, ["value"]);
members(CSSMathClamp, ["lower", "value", "upper"]);

/** `open` and `close` go around what needs them. `forEngine` has all the digits, and can be parsed. */
function numericText(it: CSSNumericValue, forEngine: boolean, open = "calc(", close = ")"): string {
  const { operator, value, unit, list } = it.$impl;
  const nested = (it: CSSNumericValue) => numericText(it, forEngine, "(");
  if (operator === undefined) {
    const suffix = unit === "number" ? "" : unit === "percent" ? "%" : unit;
    if (Number.isFinite(value)) return (forEngine ? String(value) : formatNumber(value)) + suffix;
    const name = value !== value ? "NaN" : value > 0 ? "infinity" : "-infinity";
    return suffix === "" ? open + name + close : `${open}${name} * 1${suffix}${close}`;
  }
  if (operator === "negate") return open + (forEngine ? "-1 * " : "-") + nested(value) + close;
  if (operator === "invert") return open + "1 / " + nested(value) + close;
  if (operator !== "sum" && operator !== "product") {
    return `${operator}(${list.map(it => numericText(it, forEngine, "", "")).join(", ")})`;
  }
  if (list.length === 1)
    return open + numericText(list[0], forEngine, isUnit(list[0]) ? "" : "(", isUnit(list[0]) ? "" : ")") + close;
  const [inverse, plain, opposite] = operator === "sum" ? ["negate", " + ", " - "] : ["invert", " * ", " / "];
  const rest = list
    .slice(1)
    .map(it => (it.$impl.operator === inverse ? opposite + nested(it.$impl.value) : plain + nested(it)));
  return open + nested(list[0]) + rest.join("") + close;
}

const constants = { __proto__: null, e: Math.E, pi: Math.PI, infinity: Infinity, "-infinity": -Infinity, nan: NaN };
const numericToken =
  /\s*(?:\/\*[^]*?\*\/\s*)*(?:([+-]?(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)(%|[a-z]*)|(-?[a-z][a-z0-9-]*\(?|[-+*/(),]))/iy;

const terms = (it: CSSNumericValue): CSSNumericValue[] => (it instanceof CSSMathSum ? it.$impl.list : [it]);

function scale(it: CSSNumericValue, by: number): CSSNumericValue | null {
  if (isUnit(it)) return unitValue(it.$impl.value * by, it.$impl.unit);
  if (it instanceof CSSMathNegate) return scale(it.$impl.value, -by);
  const scaled = it instanceof CSSMathSum ? terms(it).map(term => scale(term, by)) : [null];
  return scaled.includes(null) ? null : new CSSMathSum(...scaled);
}

function simplifiedSum(left: CSSNumericValue, right: CSSNumericValue, subtracts: boolean): CSSNumericValue {
  const all = terms(left).slice();
  for (const term of terms(right)) {
    const inner = (it: CSSNumericValue) => (it instanceof CSSMathNegate ? it.$impl.value : it);
    const signed = (it: CSSNumericValue) => (it === inner(it) ? 1 : -1) * inner(it).$impl.value;
    const same = isUnit(inner(term)) ? all.findIndex(it => isUnit(inner(it), inner(term).$impl.unit)) : -1;
    if (same >= 0)
      all[same] = unitValue(signed(all[same]) + (subtracts ? -1 : 1) * signed(term), inner(term).$impl.unit);
    else all.push(!subtracts ? term : term === inner(term) ? new CSSMathNegate(term) : inner(term));
  }
  return all.length === 1 ? all[0] : new CSSMathSum(...all);
}

function simplifiedProduct(left: CSSNumericValue, right: CSSNumericValue, divides: boolean): CSSNumericValue {
  if (!divides && isUnit(left, "number")) [left, right] = [right, left];
  const isNumber = isUnit(right, "number");
  const by = divides ? 1 / right.$impl.value : right.$impl.value;
  const factor = isNumber ? unitValue(by, "number") : divides ? new CSSMathInvert(right) : right;
  const factors = left instanceof CSSMathProduct ? left.$impl.list : [left];
  return (isNumber ? scale(left, by) : null) ?? new CSSMathProduct(...factors, factor);
}

function parseNumeric(text: string): CSSNumericValue | null {
  const tokens: (string | CSSUnitValue)[] = [];
  text = text.trim();
  for (numericToken.lastIndex = 0; numericToken.lastIndex < text.length;) {
    const match = numericToken.exec(text);
    const unit =
      match?.[1] === undefined ? "" : /^(?:number|percent)$/i.test(match[2]) ? null : validUnit(match[2] || "number");
    if (match === null || unit === null) return null;
    tokens.push(unit === "" ? asciiLower(match[3]) : unitValue(+match[1], unit));
  }
  if (tokens.length === 1) return isUnit(tokens[0]) ? (tokens[0] as CSSUnitValue) : null;
  const simplified: string = engine.simplifyMath(text);
  if (simplified === "") return null;
  if (tokens.some(it => typeof it === "string" && /^(?!calc|min|max|clamp)[a-z-].*\($/.test(it))) {
    return /^calc\([^(]*\)$/.test(simplified) ? parseNumeric(simplified) : null;
  }
  let at = 0;
  const value = (): CSSNumericValue => {
    const token = tokens[at++];
    if (typeof token !== "string") return convert(token, canonicalOf(token.$impl.unit))!;
    if (token in constants) return unitValue(constants[token], "number");
    if (!token.endsWith("(")) throw new TypeError("Unsupported value");
    const args = [sum()];
    while (tokens[at++] === ",") args.push(sum());
    if (token === "(" || token === "calc(") return args[0];
    const made = new (token === "min(" ? CSSMathMin : token === "max(" ? CSSMathMax : (CSSMathClamp as any))(...args);
    return args.every(it => isUnit(it, args[0].$impl.unit ?? "") && !isUnit(it, "percent"))
      ? made.to(args[0].$impl.unit)
      : made;
  };
  const product = () => {
    let left = value();
    while (tokens[at] === "*" || tokens[at] === "/") {
      const divides = tokens[at++] === "/";
      left = simplifiedProduct(left, value(), divides);
    }
    return left;
  };
  const sum = () => {
    let left = product();
    while (tokens[at] === "+" || tokens[at] === "-") {
      const subtracts = tokens[at++] === "-";
      left = simplifiedSum(left, product(), subtracts);
    }
    return left;
  };
  try {
    const result = value();
    return isUnit(result) && tokens[0] === "calc(" ? new CSSMathSum(result) : result;
  } catch {
    return null;
  }
}

// ───────────────────────────── transforms ─────────────────────────────

function checked(base: string, orPercent = false) {
  return (value: unknown) => {
    const isGood = value instanceof CSSNumericValue && typeOf(value).matches(base, orPercent);
    if (!isGood) throw new TypeError(`Must pass ${base}${orPercent ? " or percentage" : ""}.`);
    return value;
  };
}
const [angle, length, lengthOrPercentage] = [checked("angle"), checked("length"), checked("length", true)];
const number = (value: unknown) => checked("number")(rectify(value));
const amount = (it: CSSNumericValue, unit: string): number => it.to(unit).$impl.value;

class CSSTransformComponent {
  declare $impl: any;

  constructor() {
    if (new.target === CSSTransformComponent) illegalConstructor();
  }
  get is2D() {
    return this.$impl.is2D;
  }
  set is2D(value) {
    if (!(this instanceof CSSPerspective) && !this.$impl.name.startsWith("skew")) this.$impl.is2D = !!value;
  }
  toMatrix() {
    const { name, is2D, x, y, z, angle, ax, ay, length, matrix } = this.$impl;
    const result = new DOMMatrix();
    if (name === "translate") return result.translateSelf(amount(x, "px"), amount(y, "px"), is2D ? 0 : amount(z, "px"));
    if (name === "scale")
      return result.scaleSelf(amount(x, "number"), amount(y, "number"), is2D ? 1 : amount(z, "number"));
    if (name === "rotate") {
      const axis = [x, y, z].map(it => amount(it, "number"));
      if (is2D) return result.rotateAxisAngleSelf(0, 0, 1, amount(angle, "deg"));
      return result.rotateAxisAngleSelf(axis[0], axis[1], axis[2], amount(angle, "deg"));
    }
    if (name === "matrix") {
      return is2D
        ? new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f])
        : DOMMatrix.fromMatrix(matrix);
    }
    if (name === "perspective") {
      if (length instanceof CSSNumericValue) (result as any).m34 = -1 / Math.max(amount(length, "px"), 1);
      return result;
    }
    if (ay !== undefined) (result as any).m12 = Math.tan(amount(ay, "rad"));
    if (ax !== undefined) (result as any).m21 = Math.tan(amount(ax, "rad"));
    return result;
  }
  toString(): string {
    return componentText(this, false);
  }
}

function componentText({ $impl: it }: CSSTransformComponent, forEngine: boolean): string {
  const { name, is2D, x, y, z, angle, ax, ay, length } = it;
  if (name === "matrix") {
    const values = Array.from(it.matrix.toFloat64Array() as number[]);
    const shown = is2D ? [0, 1, 4, 5, 12, 13].map(at => values[at]) : values;
    return `matrix${is2D ? "" : "3d"}(${shown.map(forEngine ? String : formatNumber).join(", ")})`;
  }
  let args = name === "rotate" ? (is2D ? [angle] : [x, y, z, angle]) : is2D ? [x, y] : [x, y, z];
  if (name === "skew") args = isUnit(ay) && ay.$impl.value === 0 ? [ax] : [ax, ay];
  else if (name.startsWith("skew") || name === "perspective") args = [ax ?? ay ?? length];
  const isNegative = isUnit(length) && length.$impl.value < 0;
  const shown = (isNegative ? [new CSSMathSum(length)] : args).map(it => serialize(it, forEngine));
  return `${name}${is2D || name === "perspective" ? "" : "3d"}(${shown.join(", ")})`;
}

class CSSTranslate extends CSSTransformComponent {
  constructor(x: unknown, y: unknown, z: unknown = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    super();
    const is2D = z === undefined;
    this.$impl = {
      name: "translate",
      is2D,
      x: lengthOrPercentage(x),
      y: lengthOrPercentage(y),
      z: is2D ? unitValue(0, "px") : length(z),
    };
  }
}
members(CSSTranslate, ["x", "y"], lengthOrPercentage);
members(CSSTranslate, ["z"], length);
class CSSRotate extends CSSTransformComponent {
  constructor(...args: unknown[]) {
    if (args.length !== 1 && args.length < 4) core.tooFew(4);
    super();
    const [x, y, z] = (args.length === 1 ? [0, 0, 1] : args.slice(0, 3)).map(number);
    this.$impl = { name: "rotate", is2D: args.length === 1, x, y, z, angle: angle(args[args.length === 1 ? 0 : 3]) };
  }
}
Object.defineProperty(CSSRotate, "length", { value: 1 });
members(CSSRotate, ["angle"], angle);
class CSSScale extends CSSTransformComponent {
  constructor(x: unknown, y: unknown, z: unknown = undefined) {
    if ($argumentCount() < 2) core.tooFew(2);
    super();
    this.$impl = {
      name: "scale",
      is2D: z === undefined,
      x: number(x),
      y: number(y),
      z: number(z === undefined ? 1 : z),
    };
  }
}
for (const ctor of [CSSRotate, CSSScale]) members(ctor, ["x", "y", "z"], number);
class CSSSkew extends CSSTransformComponent {
  constructor(ax: unknown, ay: unknown) {
    if ($argumentCount() < 2) core.tooFew(2);
    super();
    this.$impl = { name: "skew", is2D: true, ax: angle(ax), ay: angle(ay) };
  }
}
class CSSSkewX extends CSSTransformComponent {
  constructor(ax: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = { name: "skewX", is2D: true, ax: angle(ax) };
  }
}
class CSSSkewY extends CSSTransformComponent {
  constructor(ay: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = { name: "skewY", is2D: true, ay: angle(ay) };
  }
}
for (const ctor of [CSSSkew, CSSSkewX]) members(ctor, ["ax"], angle);
for (const ctor of [CSSSkew, CSSSkewY]) members(ctor, ["ay"], angle);

function perspective(value: unknown) {
  if (value instanceof CSSNumericValue) return length(value);
  const keyword = value instanceof CSSKeywordValue ? value : new CSSKeywordValue(`${value}`);
  if (asciiLower(keyword.$impl.value) !== "none") throw new TypeError("Must pass length or none to CSSPerspective");
  return keyword;
}
class CSSPerspective extends CSSTransformComponent {
  constructor(length: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = { name: "perspective", is2D: false, length: perspective(length) };
  }
}
members(CSSPerspective, ["length"], perspective);

function matrixOf(value: any, ctor: any) {
  if (!(value instanceof ctor)) throw new TypeError(`The provided value is not of type '${ctor.name}'.`);
  return value;
}
class CSSMatrixComponent extends CSSTransformComponent {
  constructor(matrix: any, options: any = {}) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    const copy = DOMMatrix.fromMatrix(matrixOf(matrix, Object.getPrototypeOf(DOMMatrix)));
    this.$impl = { name: "matrix", is2D: !!(options?.is2D ?? matrix.is2D), matrix: copy };
  }
}
members(CSSMatrixComponent, ["matrix"], value => matrixOf(value, DOMMatrix));

const component = (value: unknown) => matrixOf(value, CSSTransformComponent);
class CSSTransformValue extends CSSStyleValue {
  constructor(transforms: Iterable<unknown>) {
    if ($argumentCount() < 1) core.tooFew(1);
    super();
    this.$impl = Array.from(sequence(transforms), component);
    if (this.$impl.length === 0) throw new TypeError("CSSTransformValue must have at least one component");
    return indexed(this, component);
  }
  get length() {
    return this.$impl.length;
  }
  get is2D() {
    return this.$impl.every(it => it.$impl.is2D);
  }
  toMatrix() {
    return this.$impl.reduce((matrix, it) => matrix.multiplySelf(it.toMatrix()), new DOMMatrix());
  }
}
iterable(CSSTransformValue, true);

function parseComponent(text: string) {
  const name = asciiLower(text.slice(0, text.indexOf("(")));
  const sources: string[] = engine.splitValue(text.slice(name.length + 1, -1), true);
  if (name === "perspective" && sources[0] === "none") return new CSSPerspective("none");
  const args = sources.map(parseNumeric);
  if (args.includes(null)) throw new TypeError("Unsupported value");
  const zero = (unit: string) => unitValue(0, unit);
  const angles = args.map(it => (isUnit(it, "number") ? zero("deg") : it));
  const factors = args.map(it => (isUnit(it, "percent") ? it!.$impl.value / 100 : it));
  const [a, b, c] = args;
  switch (name) {
    case "translate":
    case "translatex":
      return new CSSTranslate(a, b ?? zero("px"));
    case "translatey":
      return new CSSTranslate(zero("px"), a);
    case "translatez":
      return new CSSTranslate(zero("px"), zero("px"), a);
    case "translate3d":
      return new CSSTranslate(a, b, c);
    case "scale":
      return new CSSScale(factors[0], factors[1] ?? factors[0]);
    case "scalex":
      return new CSSScale(factors[0], 1);
    case "scaley":
      return new CSSScale(1, factors[0]);
    case "scalez":
      return new CSSScale(1, 1, factors[0]);
    case "scale3d":
      return new CSSScale(factors[0], factors[1], factors[2]);
    case "rotate":
      return new CSSRotate(angles[0]);
    case "rotate3d":
      return new CSSRotate(a, b, c, angles[3]);
    case "skew":
      return new CSSSkew(angles[0], angles[1] ?? zero("deg"));
    case "skewx":
      return new CSSSkewX(angles[0]);
    case "skewy":
      return new CSSSkewY(angles[0]);
    case "perspective":
      return new CSSPerspective(a);
    case "matrix":
    case "matrix3d":
      return new CSSMatrixComponent(new DOMMatrix(args.map(it => amount(it!, "number"))));
    default:
      return new CSSRotate(+(name === "rotatex"), +(name === "rotatey"), +(name === "rotatez"), angles[0]);
  }
}

class CSSPositionValue extends CSSStyleValue {
  constructor(x: unknown, y: unknown) {
    if ($argumentCount() < 2) core.tooFew(2);
    super();
    this.$impl = { x: lengthOrPercentage(x), y: lengthOrPercentage(y) };
  }
}
members(CSSPositionValue, ["x", "y"], lengthOrPercentage);

function parsePosition(words: string[]): CSSPositionValue | null {
  const edges = { __proto__: null, left: 0, top: 0, center: 50, right: 100, bottom: 100 };
  if (words.length === 1) words.push("center");
  const half = words.length / 2;
  if (/^(?:top|bottom)$/.test(words[0]) || /^(?:left|right)$/.test(words[half]))
    words = [...words.slice(half), ...words.slice(0, half)];
  const [x, y] = [0, half].map(at => {
    if (half === 1) return words[at] in edges ? unitValue(edges[words[at]], "percent") : parseNumeric(words[at]);
    const offset = parseNumeric(words[at + 1]);
    return edges[words[at]] === 0 || offset === null
      ? offset
      : new CSSMathSum(unitValue(100, "percent"), new CSSMathNegate(offset));
  });
  return x === null || y === null ? null : new CSSPositionValue(x, y);
}

function serialize(value: any, forEngine: boolean): string {
  const it = value.$impl;
  if (value instanceof CSSNumericValue) return numericText(value, forEngine);
  if (value instanceof CSSKeywordValue) return forEngine ? escape(it.value) : it.value;
  if (value instanceof CSSUnparsedValue) return unparsedText(value, []);
  if (value instanceof CSSTransformValue) return it.map(part => componentText(part, forEngine)).join(" ");
  if (value instanceof CSSPositionValue) return numericText(it.x, forEngine) + " " + numericText(it.y, forEngine);
  return it.text;
}

// ───────────────────────────── properties ─────────────────────────────

const setOf = (names: string) => new Set<string>(splitTokens(names));
const untyped =
  setOf(`align-content align-items align-self animation-range-end animation-range-start animation-trigger app-region
  appearance aspect-ratio background-position background-repeat box-decoration-break buffered-rendering color-scheme
  contain-intrinsic-height contain-intrinsic-size contain-intrinsic-width content fill font-family hyphenate-character
  hyphenate-limit-chars image-orientation initial-letter interest-delay-end interest-delay-start justify-content justify-items
  justify-self list-style-type overflow-block overflow-clip-margin overflow-inline overscroll-behavior-block
  overscroll-behavior-inline print-color-adjust rotate ruby-align ruby-overhang ruby-position scale scroll-initial-target
  scroll-timeline-axis scroll-timeline-name scrollbar-color speak stroke text-box-edge text-emphasis-position
  text-emphasis-style text-fit timeline-scope timeline-trigger-name transform-origin translate window-drag zoom`);
const isUntyped = (name: string) =>
  untyped.$has(name) || /^(?:-|corner-|mask-(?!type)|view-timeline-|timeline-trigger-activ)/.test(name);
const onlySetTyped = /^border-image-(?!source)|^(?:column|row)-rule-(?:width|style|color)/;
const lists = setOf(`animation-composition animation-delay animation-direction animation-duration animation-fill-mode
  animation-iteration-count animation-name animation-play-state animation-range-end animation-range-start animation-timeline
  animation-timing-function animation-trigger background-attachment background-blend-mode background-clip background-image
  background-origin background-size scroll-timeline-axis scroll-timeline-name timeline-scope transition-behavior
  transition-delay transition-duration transition-timing-function view-timeline-axis view-timeline-inset view-timeline-name`);
const isList = (name: string) => lists.$has(name) || name.startsWith("timeline-trigger-");
const positions = setOf("object-position offset-anchor offset-position perspective-origin");
const images = setOf("background-image border-image-source list-style-image shape-outside");
const withoutNumbers = setOf("baseline-shift cx cy r rx ry stroke-dashoffset stroke-width x y");
const onlyKeywords = /^(?:grid-(?:row|column)-|grid-template-|stroke-dasharray)/;
/** Of the properties whose values may be any of many names. */
const hasNames =
  /-color$|^color$|^counter-|^grid-(?:row|column)-|^(?:transition-property|will-change)$|^view-transition-/;
const fixedKeywords = setOf("auto contain currentcolor nearest none normal");
const wideKeywords = setOf("initial inherit unset revert revert-layer revert-rule");

function validProperty(name: unknown) {
  const it = propertyNamed(name);
  if (!it.isCustom && engine.longhands(it.name).length === 0) throw new TypeError("Invalid propertyName: " + name);
  return it;
}

const isKeywordOf = (name: string, keyword: string) =>
  hasNames.test(name)
    ? fixedKeywords.$has(keyword)
    : !keyword.startsWith("--") || /^(?:animation|container)-name$|^page$/.test(name);

function reifyOne(name: string, text: string, source: string): CSSStyleValue {
  let value: CSSStyleValue | null = null;
  if (isUntyped(name) || onlySetTyped.test(name)) {
  } else if (
    /^--?[a-z_-][\w-]*$|^-?[a-z_][\w-]*$/i.test(text) &&
    !(positions.$has(name) && !fixedKeywords.$has(text))
  ) {
    if (isKeywordOf(name, text) && !/\s/.test(source)) value = new CSSKeywordValue(text);
  } else if (positions.$has(name)) value = parsePosition(engine.splitValue(text, false));
  else if (name === "transform") {
    try {
      value = new CSSTransformValue(engine.splitValue(text, false).map(parseComponent));
    } catch {}
  } else if (images.$has(name) && text.startsWith("url(")) value = make(CSSImageValue, new Plain(name, text));
  else if (!onlyKeywords.test(name)) {
    value = parseNumeric(name === "background-size" ? text.replace(/ auto$/, "") : text);
    const exact = value && parseNumeric(source);
    if (exact !== null && (!isUnit(value) || isUnit(exact, value!.$impl.unit))) value = exact;
    if (isUnit(value, "number") && withoutNumbers.$has(name)) value = null;
  }
  return value ?? make(CSSStyleValue, new Plain(name, source));
}

/** `text` is a serialization, and `source` what it is of. */
function reify({ name, isCustom, isShorthand }: any, text: string, source: string): CSSStyleValue[] {
  if (wideKeywords.$has(text)) return [new CSSKeywordValue(text)];
  if (isCustom || engine.splitVariables(text).length > 3) return [parseUnparsed(text)];
  if (isShorthand) return [make(CSSStyleValue, new Plain(name, source))];
  if (!isList(name)) return [reifyOne(name, text, source)];
  const sources = engine.splitValue(source, true);
  return engine.splitValue(text, true).map((it, index) => reifyOne(name, it, sources[index] ?? it));
}

function parseValues(it: any, text: string): CSSStyleValue[] {
  const { values } = it.parse(text, "", "");
  if (values.length === 0 || text === "") throw new TypeError(`Failed to parse '${text}' as a value of ${it.name}.`);
  return reify(it, it.isShorthand && !wideKeywords.$has(values[2]) ? text : values[2], text.trim());
}

/** What the engine gets. */
function coerce(it: any, value: unknown, isAlone: boolean): string {
  const { name } = it;
  const isValid = (text: string) => it.parse(text, "", "").values.length > 0;
  let text = value instanceof CSSStyleValue ? serialize(value, true) : `${value}`;
  let isGood = true;
  if (value instanceof CSSUnparsedValue) isGood = isAlone;
  else if (!(value instanceof CSSStyleValue)) isGood = isAlone || engine.splitVariables(text).length <= 3;
  else if (value instanceof CSSImageValue) isGood = images.$has(name);
  else if (value.$impl instanceof Plain) isGood = value.$impl.property === name;
  else if (value instanceof CSSKeywordValue && wideKeywords.$has(asciiLower(text))) isGood = isAlone;
  else if (it.isCustom || it.isShorthand || isUntyped(name)) isGood = false;
  else if (value instanceof CSSKeywordValue)
    isGood = isKeywordOf(name, asciiLower(text)) && (!positions.$has(name) || fixedKeywords.$has(text));
  else if (value instanceof CSSPositionValue) isGood = positions.$has(name);
  else if (value instanceof CSSNumericValue) {
    const isNumber = typeOf(value).matches("number");
    isGood = !positions.$has(name) && !onlyKeywords.test(name) && !(isNumber && withoutNumbers.$has(name));
    isGood &&= !(name === "shape-image-threshold" && !isNumber);
    if (isUnit(value) && !isUnit(value, "fr")) {
      isGood &&= isValid(`calc(${text})`);
      if (!isValid(text) || (name === "tab-size" && isNumber && !Number.isInteger(value.$impl.value)))
        text = `calc(${text})`;
    }
  }
  if (!isGood || !(isValid(text) || value instanceof CSSUnparsedValue))
    throw new TypeError("Invalid type for property");
  return text;
}

class StylePropertyMapReadOnly {
  declare $impl: any;

  constructor() {
    illegalConstructor();
  }
  get(property: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return valuesOf(this.$impl, validProperty(property))[0];
  }
  getAll(property: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return valuesOf(this.$impl, validProperty(property));
  }
  has(property: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    return this.$impl.typedValue(validProperty(property)) !== null;
  }
  get size() {
    return this.$impl.names().length;
  }
  *entries() {
    for (const name of this.$impl.names().slice()) yield [name, valuesOf(this.$impl, propertyNamed(name))];
  }
  *keys() {
    yield* this.$impl.names().slice();
  }
  *values() {
    for (const [, values] of this.entries()) yield values;
  }
  forEach(callback: Function, thisArg: unknown = undefined) {
    for (const [name, values] of this.entries()) (callback as any).$call(thisArg, values, name, this);
  }
}
Object.defineProperty(StylePropertyMapReadOnly.prototype, Symbol.iterator, {
  value: StylePropertyMapReadOnly.prototype.entries,
  writable: true,
  configurable: true,
});

/** The last values that were set, with what the engine has made of them. */
const given = new WeakMap<object, Map<string, [string, CSSStyleValue]>>();

function clone(value: any): any {
  if (value instanceof CSSUnparsedValue) return parseUnparsed(serialize(value, true));
  if (value instanceof CSSKeywordValue) return new CSSKeywordValue(asciiLower(value.$impl.value));
  return isUnit(value)
    ? unitValue(value.$impl.value, value.$impl.unit)
    : new value.constructor(...value.$impl.list.map(clone));
}

function valuesOf(style: any, it: any): CSSStyleValue[] {
  const found: string[] | null = style.typedValue(it);
  if (found === null) return [];
  const [text, source, syntax] = found;
  const known = given.get(style)?.$get(it.name);
  if (known !== undefined && known[0] === source) return [clone(known[1])];
  if (!syntax) return reify(it, text, source);
  const items: string[] = /[+#]$/.test(syntax) ? engine.splitValue(text, syntax.endsWith("#")) : [text];
  return items.map(item => {
    if (syntax.startsWith("<transform-list")) return reifyOne("transform", item, item);
    if (syntax.startsWith("<image")) return make(CSSImageValue, new Plain(it.name, item));
    if (syntax.startsWith("<custom-ident") || syntax[0] !== "<") return new CSSKeywordValue(item);
    return parseNumeric(item) ?? make(CSSStyleValue, new Plain(it.name, item));
  });
}

class StylePropertyMap extends StylePropertyMapReadOnly {
  set(property: string, ...values: unknown[]) {
    if ($argumentCount() < 1) core.tooFew(1);
    const it = validProperty(property);
    if (values.length === 0 || (values.length > 1 && !isList(it.name)))
      throw new TypeError("Invalid type for property");
    const text = values.map(value => coerce(it, value, values.length === 1)).join(", ");
    this.$impl.set(it, text === "" ? " " : text, "");
    const [first] = values;
    const isNumeric = first instanceof CSSNumericValue;
    const isKept =
      isNumeric ||
      first instanceof CSSUnparsedValue ||
      (first instanceof CSSKeywordValue && onlySetTyped.test(it.name));
    if (values.length > 1 || !isKept) return void given.get(this.$impl)?.$delete(it.name);
    const impl = this.$impl;
    if (!given.has(impl)) given.set(impl, new Map());
    const kept = isUnit(first) && text.startsWith("calc(") ? new CSSMathSum(clone(first)) : clone(first);
    given.get(this.$impl)!.$set(it.name, [this.$impl.typedValue(it)[1], kept]);
  }
  append(property: string, ...values: unknown[]) {
    if ($argumentCount() < 1) core.tooFew(1);
    const it = validProperty(property);
    if (!isList(it.name)) throw new TypeError("Property does not support multiple values");
    const old = valuesOf(this.$impl, it);
    const all = [...old, ...values].map(value => coerce(it, value, false));
    if (values.length > 0) this.$impl.set(it, all.join(", "), "");
  }
  delete(property: string) {
    if ($argumentCount() < 1) core.tooFew(1);
    this.$impl.remove(validProperty(property));
  }
  clear() {
    this.$impl.setText("");
  }
}

function milliseconds(value: CSSNumericValue): number {
  return amount(value, typeOf(value).matches("number") ? "number" : "ms");
}

const classes = [
  CSSStyleValue,
  CSSImageValue,
  CSSKeywordValue,
  CSSUnparsedValue,
  CSSVariableReferenceValue,
  CSSPositionValue,
  CSSNumericValue,
  CSSUnitValue,
  CSSNumericArray,
  CSSMathValue,
  CSSMathSum,
  CSSMathProduct,
  CSSMathMin,
  CSSMathMax,
  CSSMathClamp,
  CSSMathNegate,
  CSSMathInvert,
  CSSTransformValue,
  CSSTransformComponent,
  CSSTranslate,
  CSSRotate,
  CSSScale,
  CSSSkew,
  CSSSkewX,
  CSSSkewY,
  CSSPerspective,
  CSSMatrixComponent,
  StylePropertyMapReadOnly,
  StylePropertyMap,
];
for (const ctor of classes) expose(ctor);

export default {
  isNumeric: (value: unknown) => value instanceof CSSNumericValue,
  isPercentage: (value: unknown) => value instanceof CSSNumericValue && typeOf(value).matches("percent"),
  milliseconds,
  parseNumeric,
  percent: (value: number) => unitValue(value, "percent"),
  px: (value: number) => unitValue(value, "px"),
  styleMap: (style: object, isWritable: boolean) =>
    make(isWritable ? StylePropertyMap : StylePropertyMapReadOnly, style),
  unit: (value: unknown, unit: string) => new CSSUnitValue(value as number, unit),
};
