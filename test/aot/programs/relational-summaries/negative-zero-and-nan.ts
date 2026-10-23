// Two values that integer arithmetic does not have. -0 comes out of a product, a remainder, a negation, a rounding of integers; NaN is the one value that is not equal to itself, so "the result IS the parameter" does not make `f(x) === x` true. Every answer is shown by Object.is and by 1 / x.
const show = (x: number): string => (Object.is(x, -0) ? "-0" : String(x));
function multiply(a: number, b: number): number {
  return a * b;
}
function remainder(a: number, b: number): number {
  return a % b;
}
function negate(a: number): number {
  return -a;
}
function divide(a: number, b: number): number {
  return a / b;
}
function add(a: number, b: number): number {
  return a + b;
}
function subtract(a: number, b: number): number {
  return a - b;
}
function round(a: number): number {
  return Math.round(a);
}
function larger(a: number, b: number): number {
  return Math.max(a, b);
}
function smaller(a: number, b: number): number {
  return Math.min(a, b);
}
function largerByHand(a: number, b: number): number {
  return a > b ? a : b;
}
function truncated(a: number): number {
  return Math.trunc(a);
}
function identity<T>(x: T): T {
  return x;
}
function timesMinusOne(a: number): number {
  return a * -1;
}
function zeroMinus(a: number): number {
  return 0 - a;
}
let warm = 0;
for (let i = 1; i < 3000; i++) {
  warm += multiply(i, 2) + remainder(i, 3) + negate(i) + divide(i * 4, 2) + add(i, i) + subtract(i, 1) + round(i) + larger(i, 3) + smaller(i, 3) + largerByHand(i, 3) + truncated(i) + identity(i) + timesMinusOne(i) + zeroMinus(i);
}
console.log(warm);
console.log([multiply(0, -1), multiply(-1, 0), multiply(0, 1), multiply(-0, -0), multiply(-5, 0), multiply(0, -2147483648)].map(show).join());
console.log([remainder(-4, 2), remainder(4, -2), remainder(-1, 1), remainder(0, 5), remainder(-0, 5), remainder(5, 0), remainder(-2147483648, -1), remainder(-3, 3)].map(show).join());
console.log([negate(0), negate(-0), negate(1), timesMinusOne(0), zeroMinus(0), zeroMinus(-0), negate(negate(0))].map(show).join());
console.log([divide(0, -1), divide(-0, 1), divide(0, 1), divide(1, 0), divide(1, -0), divide(-1, 0), divide(0, 0), divide(1, multiply(0, -1)), divide(-6, 3), divide(0, -5)].map(show).join());
console.log([add(-0, -0), add(-0, 0), add(0, -0), subtract(-0, 0), subtract(0, 0), subtract(-0, -0), add(negate(0), negate(0))].map(show).join());
console.log([round(-0.4), round(-0.5), round(0.4), round(-0), round(-0.6), round(2.5), round(-2.5), truncated(-0.9), truncated(0.9), Math.ceil(-0.5), Math.floor(-0), Math.sign(-0), Math.sqrt(-0), Math.abs(-0)].map(show).join());
console.log([larger(0, -0), larger(-0, 0), larger(-0, -0), smaller(0, -0), smaller(-0, 0), largerByHand(0, -0), largerByHand(-0, 0), larger(NaN, 1), smaller(1, NaN), largerByHand(NaN, 1), largerByHand(1, NaN)].map(show).join());

// -0 where it is seen and where it is not.
function describeZero(z: number): string {
  return [z === 0, Object.is(z, 0), 1 / z, String(z), `${z}`, z.toFixed(1), JSON.stringify(z), JSON.stringify([z]), [z].includes(0), [z].indexOf(0), new Set([z, 0]).size, new Map([[z, "v"]]).has(0), Math.atan2(0, z), z | 0, show(+z), show(-z), z < 0, Object.is([z][0], -0), Object.is(new Float64Array([z])[0], -0), Object.is(new Int32Array([z])[0], -0)].join();
}
console.log(describeZero(multiply(0, -1)));
console.log(describeZero(multiply(0, 1)));
console.log([...new Set([multiply(0, -3)])].map(show).join(), [...new Map([[negate(0), 1]]).keys()].map(show).join());

// A field, an element, a captured variable, a default and a result carry it on.
class Cell {
  constructor(public value: number) {}
  scaled(by: number): Cell {
    return new Cell(this.value * by);
  }
}
function throughACell(a: number, b: number): number {
  return new Cell(a).scaled(b).value;
}
function throughAList(a: number, b: number): number {
  return [a * b][0];
}
function throughAClosure(a: number, b: number): number {
  const product = a * b;
  return (() => product)();
}
for (let i = 1; i < 500; i++) warm += throughACell(i, 2) + throughAList(i, 2) + throughAClosure(i, 2);
console.log([throughACell(0, -1), throughAList(-1, 0), throughAClosure(0, -7), throughACell(3, 0)].map(show).join());

// NaN.
function equalsItself(x: unknown): boolean {
  return x === x;
}
function differsFromItself(x: unknown): boolean {
  return x !== x;
}
function comesBackTheSame(x: unknown): boolean {
  return identity(x) === x;
}
function sameAfterTwo(x: unknown): boolean {
  return identity(identity(x)) === identity(x);
}
function looselyItself(x: unknown): boolean {
  return x == x;
}
function notLess(a: number, b: number): boolean {
  return !(a < b);
}
function atLeast(a: number, b: number): boolean {
  return a >= b;
}
function pickSame(a: number): number {
  return a === a ? 1 : 2;
}
let trues = 0;
for (let i = 0; i < 3000; i++) trues += (equalsItself(i) ? 1 : 0) + (differsFromItself(i) ? 1 : 0) + (comesBackTheSame(i) ? 1 : 0) + (sameAfterTwo({}) ? 0 : 1) + (looselyItself("s") ? 1 : 0) + (notLess(i, 1) ? 1 : 0) + (atLeast(i, 1) ? 1 : 0) + pickSame(i);
console.log(trues);
const nan = divide(0, 0);
console.log(equalsItself(nan), differsFromItself(nan), comesBackTheSame(nan), sameAfterTwo(nan), looselyItself(nan), notLess(nan, 1), atLeast(nan, 1), notLess(1, nan), atLeast(1, nan), pickSame(nan));
console.log(equalsItself(undefined), equalsItself(null), comesBackTheSame(-0), comesBackTheSame("x"), equalsItself([nan]), comesBackTheSame({ nan }));
console.log([nan].includes(nan), [nan].indexOf(nan), [nan].findIndex(x => Object.is(x, nan)), new Set([nan, nan, remainder(1, 0)]).size, new Map([[nan, "found"]]).get(subtract(Infinity, Infinity)), Object.is(nan, remainder(5, 0)));
function bySwitch(x: number): string {
  switch (x) {
    case NaN:
      return "NaN";
    case 0:
      return "zero";
    default:
      return "default";
  }
}
console.log(bySwitch(nan), bySwitch(-0), bySwitch(multiply(0, -1)), bySwitch(1));
console.log(nan | 0, nan >>> 0, ~~nan, Math.round(nan), [3, nan, 1].sort().join(), [3, nan, 1].sort((a, b) => a - b).length, Math.max(...[1, nan]), isNaN(add(nan, 1)), Number.isInteger(nan), [1, 2, 3][nan as number], "abc".charAt(nan), "abc".slice(nan), "abc".substring(nan, 2), new Array(3).fill(0, nan).length);
console.log(add(undefined as unknown as number, 1), multiply("x" as unknown as number, 2), subtract({} as unknown as number, 1), negate(undefined as unknown as number), add(null as unknown as number, 1), show(multiply(null as unknown as number, -1)), show(negate(null as unknown as number)), show(negate("" as unknown as number)), show(negate([] as unknown as number)), show(multiply(false as unknown as number, -1)));
