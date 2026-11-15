const source: any[] = JSON.parse("[0, -0.0, 1, -1, 2147483647, -2147483648, 2147483648, -2147483649, 4294967295, 4294967296, 4294967301, 9007199254740991, 1e300, -1e300, 0.5, -0.5, 31, 32, 33, 63]");
source.push(NaN, Infinity, -Infinity, -0);
const boxed: any[] = [];
const numbers: number[] = source.slice();
let sum = 0;
function store(value: number, by: number) {
  boxed.push(value * by, value + by, value / 4, Math.floor(value), -value);
}
function shifted(a: any, b: any) {
  const left = (a << b) >>> 0, right = a >> b, high = a >>> b;
  return numbers[left & 15] + left + "," + (numbers[high] ?? "-") + "," + (right + high * 2) + "," + `${high}:${left}`;
}
function divided(a: any, b: any) {
  const x = a | 0, y = b | 0;
  const quotient = y ? (x / y) | 0 : 0, remainder = y ? x % y : 0;
  return (quotient >>> 0) + ":" + (numbers[quotient] ?? "-") + ":" + (remainder >>> 0) + ":" + (numbers[remainder] ?? "-") + ":" + (y ? (x >>> 0) % (y >>> 0 || 1) : 0);
}
function total(values: any[]) {
  let t = 0;
  for (let i = 0; i < values.length; i++) t = t * 0.5 + values[i];
  for (const value of values) t += value;
  return t;
}
function masks(value: any) {
  const word = value | 0;
  const low = word & 0xff, half = word & 0xffff, twice = word << 1;
  return low + half * 2 + twice + word + (low ^ half ^ twice ^ word) + (numbers[low & 15] || 0);
}
function index(values: number[], at: any) {
  return values.indexOf(at) + ":" + values.includes(at) + ":" + (values[at] ?? "none");
}
const words = new Int32Array(64).map((_, k) => Math.imul(k, 0x9e3779b1) >> (k & 15));
const fractions = new Float64Array(64).map((_, k) => (k & 1 ? words[k] : words[k] / 2));
function shiftWords(by: number) {
  let t = 0;
  for (let i = 0; i < 64; i++) {
    const word = words[i], amount = words[(i + by) & 63] & 31;
    const left = word << amount, high = word >>> amount, right = word >> amount;
    t = (t * 31 + (left >>> 0) + high + (fractions[left & 63] || 0) + (words[high] ?? 7) + right * 0.5) % 1000003;
  }
  return t;
}
function divideWords(by: number) {
  let t = 0;
  for (let i = 0; i < 64; i++) {
    const word = words[i], divisor = words[(i + by) & 63] | 1;
    const quotient = (word / divisor) | 0, remainder = (word % divisor) | 0;
    t = (t * 31 + (quotient >>> 0) + (remainder >>> 0) + (words[quotient & 63] ^ (words[remainder] ?? 3))) % 1000003;
  }
  return t;
}
function boxFractions(to: any[]) {
  for (let i = 0; i < 64; i++) to[i] = fractions[i] + fractions[63 - i];
  for (let i = 0; i < 64; i++) to.push(-fractions[i]);
  return to.map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" ");
}
for (let by = 0; by < 70; by += 23) console.log(shiftWords(by), divideWords(by), boxFractions([]));
for (const a of source) {
  for (const b of source) {
    store(a, b);
    sum = (sum + shifted(a, b).length * 31 + divided(a, b).length) % 1000003;
  }
  console.log(a, shifted(a, 3), shifted(5, a), divided(a, 7), divided(1000003, a), masks(a), index(numbers, a));
}
console.log(sum, total(source.slice(0, 10)), total([1, 2.5, 3, 4.25]), boxed.length, boxed.slice(0, 200).map(value => (Object.is(value, -0) ? "-0" : String(value))).join(" "));
