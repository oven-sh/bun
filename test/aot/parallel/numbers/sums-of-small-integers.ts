// STATISTIC: SumsBoundedByIterations >= 3
// Sums of integers in counted loops: elements of views, masks, shifts, counts of leading zeros, results of calls, fields of literals. From 0, from below zero, from a fraction, from the last exact integers.
const lines: string[] = [];
const bytes = new Uint8Array(40);
const shorts = new Int16Array(40);
const list: number[] = [];
for (let i = 0; i < 40; i++) {
  bytes[i] = i * 37;
  shorts[i] = i * -977;
  list.push(i * 1001 - 20000);
}
function ofBytes(n: number, start: number): number {
  let sum = start;
  for (let i = 0; i < n; i++) sum += bytes[i]!;
  return sum;
}
function ofShorts(n: number, start: number): number {
  let sum = start;
  for (let i = 0; i < shorts.length; i++) if (i % 3 !== n % 3) sum -= shorts[i]!;
  return sum;
}
function ofMasks(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += list[i % 40]! & 1023;
    if (i & 1) sum -= list[i % 40]! >> 20;
  }
  return sum;
}
function ofZeros(n: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) {
    sum += Math.imul(k, 2654435761) >>> 28;
    sum += Math.clz32(k);
  }
  return sum;
}
function nested(n: number): number {
  let sum = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < 40; x++) sum += bytes[x]! & y;
  return sum;
}
function downward(n: number): number {
  let sum = -5;
  for (let i = n - 1; i >= 0; i--) sum += bytes[i]! >>> 3;
  return sum;
}
const starts = [0, -7, 0.5, -0, 2147483647, -2147483648, 9007199254740990, 9007199254740992, -9007199254740991, NaN, Infinity];
for (let turn = 0; turn < 3; turn++) {
  for (const start of starts) lines.push([ofBytes(40, start), ofBytes(41, start), ofShorts(turn, start)].join(" "));
  for (const n of [0, 1, 39, 100]) lines.push([ofMasks(n), ofZeros(n), nested(n), downward(Math.min(n, 41))].join(" "));
}
let late = 0;
for (let i = 0; i < 5000; i++) late += bytes[i % 40]!;
console.log(lines.join("\n") + " " + late);
class Reader {
  at = 0;
  constructor(readonly bytes: Uint8Array) {}
  sum(): number {
    let sum = 0;
    for (this.at = 0; this.at < this.bytes.length; this.at++) sum += this.bytes[this.at]!;
    return sum;
  }
  rest(step: number): number {
    let sum = 0;
    for (this.at = 3; this.at < this.bytes.length; this.at += step) {
      sum += this.bytes[this.at]!;
      if (sum > 2000) this.at++;
    }
    return sum;
  }
}
const read: string[] = [];
for (const view of [bytes, new Uint8Array(0), Buffer.alloc(30, 200)]) for (let turn = 0; turn < 3; turn++) read.push(new Reader(view).sum() + " " + new Reader(view).rest(turn + 1));
console.log(read.join());

const pair = { first: 1, second: { third: 2 } };
function small(x: number): number {
  return (x * 7) & 31;
}
function destructured(n: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const { first: a, second: { third: b } } = pair;
    sum += a + b;
  }
  return sum;
}
function called(n: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) sum = small(k) + sum;
  return sum;
}
function chosen(n: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += k % 3 === 1 ? 5 : -2;
  return sum;
}
function joined(n: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) {
    if (k & 1) continue;
    if (k > 90) sum -= k & 7;
    else sum += small(k);
  }
  return sum;
}
// 12 * (2 ** 52 - 1) is past the last exact integer: the sum of the doubles is rounded.
function rounded(): number {
  let sum = 0;
  for (let k = 0; k < 12; k++) sum += 4503599627370495;
  return sum;
}
function withLateValue(n: number, at: number, value: number): number {
  let sum = 0;
  for (let k = 0; k < n; k++) sum += k === at ? value : small(k);
  return sum;
}
function readBetween(n: number): string {
  let sum = 0;
  const seen: (number | string)[] = [];
  for (let k = 0; k < n; k++) {
    sum -= k & 3;
    seen.push(sum, sum & 255, sum / 4, Object.is(sum, -0) ? "-0" : 1 / sum);
  }
  return seen.join();
}
for (const n of [0, 1, 12, 100]) console.log(destructured(n), called(n), chosen(n), joined(n), readBetween(Math.min(n, 12)));
console.log(rounded(), destructured(5), called(37), chosen(1000), joined(1000));
for (const value of [0.5, NaN, -0, Infinity, 2 ** 31, 2 ** 53, 1e300]) console.log(withLateValue(20, 3, value), withLateValue(20, 19, value), withLateValue(3, 19, value));
