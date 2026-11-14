// Functions that known code calls with small integers alone, and unknown code with everything else: their entries test for the range.
const table = new Uint8Array(256).map((_, i) => 255 - i);
function low(value) { return value & 255; }
function read(at) { return table[at]; }
function half(value) { return value >> 1; }
function wide(value) { return value & 65535; }
function around(value) { return value - 100 & 1023; }
function compared(value) { return value < 256 ? "small" : "large"; }
function two(a, b) { return a * 256 + b; }
function negative(value) { return value < -128 ? "far" : value > 127 ? "above" : "byte"; }
let sum = 0;
for (let i = 0; i < 300; i++) {
  const byte = i & 255;
  sum += low(byte) + read(byte) + half(byte) + wide(i * 7 & 65535) + around(byte) + compared(byte).length + two(byte, 255 - byte) + negative(byte - 128).length;
}
console.log(sum);
const values = [0, 1, 127, 128, 255, 256, 257, 65535, 65536, -1, -128, -129, 2147483647, 2147483648, -2147483648, 4294967295, 0.5, -0, NaN, Infinity, 255.5, 1e300, "7", "x", null, undefined, true, 7n, {}, [3]];
const said = value => Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value);
function unknown(name, f) {
  const answers = [];
  for (const value of values) {
    for (const other of [value, 3]) {
      try { answers.push(said(f(value, other))); } catch (fault) { answers.push(fault.name); }
    }
  }
  console.log(name, answers.join());
}
const functions = { low, read, half, wide, around, compared, two, negative };
for (const name of Object.keys(functions).sort()) unknown(name, functions[name]);
// A double that holds an integer of the range, and one that does not.
const doubles = new Float64Array([0, 255, 256, -1, 254.5, 65536]);
for (const name of Object.keys(functions)) console.log(name, Array.from(doubles, value => said(functions[name](value, value))).join());
console.log([300, 3, 255, 256].map(low).join(), [300, 3, 255, 256].map(read).join(), Array.from({ length: 4 }, (_, i) => i * 200).map(half).join());
