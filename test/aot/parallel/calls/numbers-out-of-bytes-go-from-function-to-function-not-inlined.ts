// Flags: --aot-validate --aot-disable=InlineCalls
// NaNs with every kind of bit pattern are read from typed arrays and a DataView and passed through functions. Some of them would be a pointer or an int32 if boxed as they are.
// The bits of a NaN are only printed once it has been boxed, or where arithmetic made it.

const bits = new BigUint64Array(8);
const list = new Float64Array(bits.buffer);
bits[0] = 0x7ff8000000000000n;
bits[1] = 0xfff8000000000000n;
bits[2] = 0xfffe000000000007n;
bits[3] = 0xffffffffffffffffn;
bits[4] = 0x7ff0000000000001n;
bits[5] = 0xfffc00000000beefn;
list[6] = 1.5;
list[7] = -Infinity;

const outBits = new BigUint64Array(1);
const out = new Float64Array(outBits.buffer);
function bytesOf(value: unknown): string {
  out[0] = value as number;
  return outBits[0].toString(16);
}

function half(value: number): number {
  return value / 2;
}
function sumOfHalves(from: Float64Array): number {
  let sum = 0;
  for (let k = 0; k < from.length; k++) sum += half(from[k]);
  return sum;
}
function twice(value: number): number {
  return half(value) * 4;
}
function larger(a: number, b: number): number {
  return a > b ? a : b;
}
function root(value: number): number {
  return Math.sqrt(Math.abs(value));
}
function down(value: number, depth: number): number {
  return depth ? down(value + 1, depth - 1) : value;
}
function elementAt(from: Float64Array, k: number): number {
  return from[k];
}
function same(value: number): number {
  return value;
}

const kept: { value: number }[] = [];
const boxed: unknown[] = [];
const doubles: number[] = [0.5];
for (let k = 0; k < list.length; k++) {
  const halved = half(list[k]);
  kept.push({ value: halved });
  boxed.push(twice(list[k]), larger(list[k], list[(k + 1) % list.length]), down(list[k], 3), elementAt(list, k), same(list[k]));
  doubles.push(root(list[k]));
  console.log(k, halved, typeof halved, Number.isNaN(halved), Object.is(halved, NaN), halved === halved, String(elementAt(list, k)), `${down(list[k], 2)}`);
}
console.log(JSON.stringify(kept), boxed.map(String).join(), doubles.join());
console.log(kept.map(entry => bytesOf(entry.value)).join(), boxed.map(bytesOf).join(), doubles.map(bytesOf).join());
console.log(sumOfHalves(list), sumOfHalves(list.subarray(6, 7)), sumOfHalves(list.subarray(6)), [sumOfHalves(list)].map(bytesOf).join());

// A map and a set tell numbers apart by their value: every NaN is one key.
const seen = new Map<number, number>();
for (let k = 0; k < list.length; k++) seen.set(half(list[k]), k);
console.log([...seen].join(";"), new Set(Array.from(list, value => twice(value))).size);

// Single precision and a view.
const words = new Uint32Array([0x7fc00000, 0xffc00000, 0xffffffff, 0x7f800001, 0x3fc00000]);
const singles = new Float32Array(words.buffer);
function third(value: number): number {
  return value / 3;
}
for (let k = 0; k < singles.length; k++) console.log(third(singles[k]), [third(singles[k])].includes(NaN), [third(singles[k])].map(bytesOf).join());
const view = new DataView(bits.buffer);
function negated(value: number): number {
  return -value;
}
for (let k = 0; k < 8; k++) console.log(`${negated(view.getFloat64(k * 8, true))}`, Number.isNaN(negated(view.getFloat64(k * 8, false))), Object.is(negated(view.getFloat64(k * 8, true)), NaN));

// The same function takes numbers that arithmetic has made: the sign of their NaN stays.
function quarter(value: number): number {
  return value / 4;
}
const zero = list[6] - 1.5;
const made = [zero / zero, -(zero / zero), Infinity - Infinity, Math.sqrt(-1 - zero), Number("x"), -Number("x")];
for (const value of made) console.log(bytesOf(quarter(value)), bytesOf(value));
for (let k = 0; k < list.length; k++) console.log([quarter(list[k])].map(bytesOf).join());

// One that is also called as a value.
function fifth(value: number): number {
  return value / 5;
}
console.log(Array.from(list, fifth).map(bytesOf).join(), made.map(fifth).map(bytesOf).join());
for (let k = 0; k < list.length; k++) console.log([fifth(list[k])].map(bytesOf).join());

// One that joins what it is handed with what it makes itself.
function orMade(value: number, makes: boolean): number {
  return makes ? -(zero / zero) : value * 2;
}
for (let k = 0; k < list.length; k++) console.log([orMade(list[k], false)].map(bytesOf).join(), bytesOf(orMade(list[k], true)));

// One whose result is undefined at times, one that throws, and one that boxes what it is handed.
function maybe(value: number): number | undefined {
  return value > 0 ? undefined : value * 2;
}
function checked(value: number): number {
  if (value < 0) throw new RangeError("negative " + value);
  return value * 2;
}
const log: unknown[] = [];
function noted(value: number): number {
  log.push(value);
  return value + 1;
}
for (let k = 0; k < list.length; k++) {
  const answer = maybe(list[k]);
  let caught = 0;
  try {
    caught = checked(list[k]);
  } catch (error) {
    console.log(String(error));
  }
  console.log(answer === undefined ? "undefined" : String(answer), String(caught), String(noted(list[k])));
}
console.log(log.map(bytesOf).join());

// Many arguments: the last ones are passed on the stack.
function total(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number): number {
  return a + b + c + d + e + f + g + h + i + j;
}
console.log(String(total(list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[6])), String(total(list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[3])), [total(list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[6], list[2], list[6])].map(bytesOf).join());
