// The remainder of any number by a power of two is exact, has the sign of the dividend and is NaN for infinities.
function show(value: number) {
  return Object.is(value, -0) ? "-0" : String(value);
}

const dividends = [0, 0.1, 0.5, 1, 1.5, 1.9999999999999998, 2, 2.5, 3, 3.75, 4, 5e-324, 1.5e-323, 2.2250738585072014e-308, 255.999, 256, 2 ** 31 - 1, 2 ** 31, 2 ** 31 + 0.5, 2 ** 32, 2 ** 32 + 1.25, 2 ** 52 + 0.5, 2 ** 53 - 1, 2 ** 53, 2 ** 53 + 2, 2 ** 63, 2 ** 64, 1e300, Number.MAX_VALUE, Infinity, NaN];
const signed = dividends.concat(dividends.map(dividend => -dividend));

function wrap(t: number) {
  t %= 2;
  if (t < -1) t += 2;
  if (t >= 1) t -= 2;
  return t;
}
function byTwo(x: number) {
  return x % 2;
}
function byMinusFour(x: number) {
  return x % -4;
}
function by256(x: number) {
  return x % 256;
}
function byTwoTo31(x: number) {
  return x % 2147483648;
}
function byTwoTo53(x: number) {
  return x % 9007199254740992;
}
function byHalf(x: number) {
  return x % 0.5;
}
function byThree(x: number) {
  return x % 3;
}

for (const x of signed) console.log(show(x), "|", show(byTwo(x)), show(byMinusFour(x)), show(by256(x)), show(byTwoTo31(x)), show(byTwoTo53(x)), show(byHalf(x)), show(byThree(x)), show(wrap(x)));

// A remainder that is an index, a word of 32 bits and a number at once.
const table = [10, 11, 12, 13, 14, 15, 16, 17];
function indexed(list: number[], x: number) {
  const r = x % 8;
  return [list[r], r | 0, r >>> 0, r * 2, Object.is(r, -0), r === 3, r ? 1 : 0].join();
}
for (const x of signed) console.log(show(x), indexed(table, x));

let sum = 0;
let negativeZeros = 0;
for (let i = 0; i < 5000; i++) {
  const x = (i - 2500) * 0.37;
  const r = x % 16;
  if (Object.is((x - r) % 16, -0)) negativeZeros++;
  sum += r + ((x * 64) % 64) + (i % 4) + (-i % 4);
}
console.log(sum, negativeZeros);

const floats = new Float64Array(signed);
const remainders = new Float64Array(floats.length);
for (let i = 0; i < floats.length; i++) remainders[i] = floats[i] % 1024;
console.log(Array.from(remainders, show).join());
