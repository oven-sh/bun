// Numbers stored into a Uint8ClampedArray: below zero, above 255, halves, NaN of several patterns, -0, infinities.
const bits = new DataView(new ArrayBuffer(8));
function fromBits(high: number, low: number) { bits.setUint32(0, high); bits.setUint32(4, low); return bits.getFloat64(0); }
const numbers = new Float64Array([
  0, -0, 0.5, 1.5, 2.5, 0.49999999999999994, 0.5000000000000001, 254.5, 254.49999999999997, 255, 255.5, 256, 300, 1e10, 2 ** 31, 2 ** 32 + 7, 2 ** 52, 2 ** 53, 1e300, Infinity,
  -0.5, -0.49999999999999994, -1, -1e10, -(2 ** 31), -Infinity, NaN, fromBits(0x7ff00000, 1), fromBits(0xfff80000, 0), fromBits(0xfff00000, 5), fromBits(0x7fffffff, 0xffffffff), 5e-324, -5e-324, 127.5, 128.5, 3.4999999999999996,
]);
function store(from: Float64Array, to: Uint8ClampedArray) { for (let i = 0; i < from.length; i++) to[i] = from[i]; }
function scale(d: Uint8ClampedArray, k: number) { for (let i = 0; i < d.length; i += 4) { d[i] = d[i] * k; d[i + 1] = d[i + 1] * k; d[i + 2] = d[i + 2] * k; } }
function mix(a: Uint8ClampedArray, o: Uint8ClampedArray) { for (let i = 0; i < a.length; i++) o[i] = 0.393 * a[i] + 0.769 * o[i] - 7.25; }
function one(d: Uint8ClampedArray, x: number) { d[0] = x; return d[0]; }
const clamped = new Uint8ClampedArray(numbers.length), other = new Uint8ClampedArray(numbers.length);
store(numbers, clamped);
console.log(clamped.join());
for (const k of [0, 0.5, 1, 1.25, -1, 3.75, NaN, Infinity, 1e-300]) { store(numbers, clamped); scale(clamped, k); console.log(k, clamped.join()); }
store(numbers, clamped);
for (let round = 0; round < 3; round++) { mix(clamped, other); mix(other, clamped); console.log(clamped.join(), other.join()); }
for (const x of numbers) console.log(one(clamped, x));
