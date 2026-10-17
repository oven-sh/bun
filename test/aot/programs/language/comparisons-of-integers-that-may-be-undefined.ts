// An element of a typed array is an integer, or undefined beyond the end. Every relation with undefined is false, whichever side it stands on; and two tests of the sign may be compared with each other.
function relations(values: Int32Array, upTo: number, bound: number): string {
  let text = "";
  for (let i = 0; i < upTo; i++) {
    const v = values[i]!;
    text += (v < 0 ? "a" : "-") + (v <= 0 ? "b" : "-") + (v > 0 ? "c" : "-") + (v >= 0 ? "d" : "-");
    text += (0 < v ? "e" : "-") + (0 <= v ? "f" : "-") + (0 > v ? "g" : "-") + (0 >= v ? "h" : "-");
    text += (v < bound ? "i" : "-") + (v <= bound ? "j" : "-") + (v > bound ? "k" : "-") + (v >= bound ? "l" : "-");
    text += (bound < v ? "m" : "-") + (bound <= v ? "n" : "-") + (bound > v ? "o" : "-") + (bound >= v ? "p" : "-");
    text += (v < 2147483647 ? "q" : "-") + (v <= -2147483648 ? "r" : "-") + (v < 9007199254740991 ? "s" : "-") + " ";
  }
  return text;
}
function bytes(values: Uint8Array, upTo: number): string {
  let text = "";
  for (let i = 0; i < upTo; i++) {
    const v = values[i]!;
    text += (v < 1 ? "a" : "-") + (v <= 255 ? "b" : "-") + (v < 0 ? "c" : "-") + (v < 256 ? "d" : "-") + (300 > v ? "e" : "-") + (v >= 0 ? "f" : "-") + " ";
  }
  return text;
}
function signs(values: Int32Array, upTo: number): string {
  let differ = 0;
  let agree = 0;
  let mixed = 0;
  let mixedAgree = 0;
  let neither = 0;
  let previous = 0;
  for (let i = 0; i < upTo; i++) {
    const v = values[i]!;
    if (v < 0 !== previous < 0) differ++;
    if (v < 0 === previous < 0) agree++;
    if (v >= 0 !== previous < 0) mixed++;
    if (v < 0 === previous >= 0) mixedAgree++;
    if (v >= 0 === previous >= 0) neither++;
    previous = v;
  }
  return [differ, agree, mixed, mixedAgree, neither].join(",");
}
function signsOfNumbers(values: number[]): string {
  let differ = 0;
  let previous = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < 0 !== previous < 0) differ++;
    previous = v;
  }
  return "" + differ;
}
class Longer extends Int32Array {
  get length(): number {
    return 4;
  }
}
function throughItsOwnLength(values: Int32Array): string {
  let text = "";
  let previous = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    text += v + ":" + (v < 0 !== previous < 0) + ",";
    previous = v;
  }
  return text;
}
const values = new Int32Array([0, -1, 1, 2147483647, -2147483648, 7, -7]);
console.log(relations(values, 9, 0));
console.log(relations(values, 9, 7));
console.log(relations(values, 8, -2147483648));
console.log(relations(values, 8, 2147483647));
console.log(bytes(new Uint8Array([0, 1, 255]), 5));
console.log(signs(values, 7), signs(values, 10), signs(new Int32Array(0), 3), signs(new Int32Array([-5]), 2));
console.log(signsOfNumbers([1, -1, -0, 0, -0.5, NaN, -Infinity, 3]), signsOfNumbers([-1e300, 1e300, -4294967296, 4294967296]));
const withOwnLength = new Int32Array([1, -2]);
Object.defineProperty(withOwnLength, "length", { value: 3 });
console.log(throughItsOwnLength(new Int32Array([1, -2])), throughItsOwnLength(new Longer([5, -6])), throughItsOwnLength(withOwnLength));
