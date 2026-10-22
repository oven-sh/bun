// Untyped code reads every field representation of a class instance by name and by key: present, undefined, null, absent, deleted, and deleted below a prototype that defines the name.
type Color = "red" | "green" | "blue";

class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

const colors: Color[] = ["red", "green", "blue"];
const boxedValues: unknown[] = [0, 1.5, "text", null, undefined, true, new Point(3, 4), -0, NaN];

class Sample {
  boxed: unknown;
  point: Point;
  color: Color;
  count: number;
  ratio: number;
  flag: boolean;
  byte: number;
  signedByte: number;
  halfWord: number;
  signedHalfWord: number;
  unsignedWord: number;
  wideInteger: number;
  optionalBoxed?: unknown;
  optionalPoint?: Point | null;
  optionalColor?: Color | null;
  optionalCount?: number | null;
  optionalRatio?: number | null;
  optionalFlag?: boolean | null;
  declare lateCount?: number | null;

  constructor(index: number, count: number) {
    this.boxed = boxedValues[index % boxedValues.length];
    this.point = new Point(index, -index);
    this.color = colors[index % colors.length];
    this.count = count;
    this.ratio = count / 2;
    this.flag = index % 2 === 0;
    this.byte = (index * 37) & 0xff;
    this.signedByte = ((index * 37) & 0xff) - 128;
    this.halfWord = (index * 4099) & 0xffff;
    this.signedHalfWord = ((index * 4099) & 0xffff) - 32768;
    this.unsignedWord = (index * 0x13579bdf) >>> 0;
    this.wideInteger = index * 2 ** 33 + index;
  }
}

class Derived extends Sample {}

const requiredNames = ["boxed", "point", "color", "count", "ratio", "flag", "byte", "signedByte", "halfWord", "signedHalfWord", "unsignedWord", "wideInteger"];
const optionalNames = ["optionalBoxed", "optionalPoint", "optionalColor", "optionalCount", "optionalRatio", "optionalFlag", "lateCount"];
const names = [...requiredNames, ...optionalNames];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof Point) return "Point(" + show(value.x) + "," + show(value.y) + ")";
  return String(value);
}

function readByName(sample: any): string {
  return [
    sample.boxed,
    sample.point,
    sample.color,
    sample.count,
    sample.ratio,
    sample.flag,
    sample.byte,
    sample.signedByte,
    sample.halfWord,
    sample.signedHalfWord,
    sample.unsignedWord,
    sample.wideInteger,
    sample.optionalBoxed,
    sample.optionalPoint,
    sample.optionalColor,
    sample.optionalCount,
    sample.optionalRatio,
    sample.optionalFlag,
    sample.lateCount,
  ]
    .map(value => show(value))
    .join(" ");
}

function readByKey(sample: any): string {
  return names.map(name => show(sample[name])).join(" ");
}

function report(label: string, sample: any) {
  const results = new Set<string>();
  for (let i = 0; i < 100; i++) {
    results.add(readByName(sample));
    results.add(readByKey(sample));
  }
  console.log(label + ": " + [...results].join("\n  differs: "));
}

function fill(sample: Sample) {
  sample.optionalBoxed = "boxed";
  sample.optionalPoint = new Point(1, 2);
  sample.optionalColor = "green";
  sample.optionalCount = 3;
  sample.optionalRatio = 0.25;
  sample.optionalFlag = false;
  sample.lateCount = 9;
}

function setAll(sample: Sample, value: null | undefined) {
  sample.optionalBoxed = value;
  sample.optionalPoint = value;
  sample.optionalColor = value;
  sample.optionalCount = value;
  sample.optionalRatio = value;
  sample.optionalFlag = value;
  sample.lateCount = value;
}

function deleteAll(sample: Sample) {
  delete sample.optionalBoxed;
  delete sample.optionalPoint;
  delete sample.optionalColor;
  delete sample.optionalCount;
  delete sample.optionalRatio;
  delete sample.optionalFlag;
  delete sample.lateCount;
}

report("parsed", JSON.parse('{"boxed":"parsed","count":2.5,"flag":false,"optionalCount":null}'));

const lowest = -(2 ** 31);
const counts = [1, 1.5, -0, NaN, 2 ** 31, 2 ** 31 - 1, lowest, lowest + 1, lowest + 2, lowest + 3, lowest + 4, lowest + 5, lowest - 1, Infinity];
for (let index = 0; index < counts.length; index++) report("count " + show(counts[index]), new Sample(index, counts[index]));

const sample = new Sample(1, 7);
report("constructed", sample);
fill(sample);
report("filled", sample);
sample.optionalCount = 1.5;
sample.optionalRatio = 8;
sample.optionalFlag = true;
sample.lateCount = lowest + 2;
report("filled with other numbers", sample);
sample.optionalCount = 4;
report("a whole number again", sample);
setAll(sample, null);
report("null", sample);
setAll(sample, undefined);
report("undefined", sample);
deleteAll(sample);
report("deleted", sample);
console.log(Object.keys(sample).join());

const inherited: Record<string, unknown> = {
  optionalBoxed: "inherited",
  optionalPoint: new Point(5, 6),
  optionalColor: "blue",
  optionalCount: 42,
  optionalRatio: 4.5,
  optionalFlag: true,
  lateCount: 43,
};
const prototype: any = Sample.prototype;
for (const name of optionalNames) prototype[name] = inherited[name];
report("deleted, the prototype defines the names", sample);

const shadowing = new Sample(2, 8);
report("constructed below that prototype", shadowing);
fill(shadowing);
report("own fields shadow the prototype", shadowing);
deleteAll(shadowing);
report("deleted below that prototype", shadowing);

Object.defineProperty(prototype, "optionalFlag", {
  get() {
    return !this.flag;
  },
  configurable: true,
});
report("deleted, the prototype has a getter", sample);
report("deleted, the same getter on another receiver", shadowing);

for (const name of optionalNames) delete prototype[name];
report("deleted, the prototype no longer defines the names", sample);

const derivedPrototype: any = Derived.prototype;
derivedPrototype.optionalCount = 1000;
derivedPrototype.lateCount = 1001;
const derived = new Derived(4, 10);
report("derived, constructed", derived);
deleteAll(derived);
report("derived, deleted", derived);
fill(derived);
report("derived, filled", derived);
console.log(Object.keys(derived).join());
