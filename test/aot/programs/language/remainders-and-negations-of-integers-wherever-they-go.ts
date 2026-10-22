const integers: number[] = [
  0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 7, -7, 8, -8, 9, -9, 10, -10, 15, -15, 16, -16, 17, -17, 100, -100, 1023, -1023, 1024, -1024, 1025, -1025,
  65535, -65535, 65536, -65536, 1073741823, -1073741823, 1073741824, -1073741824, 2147483646, -2147483646, 2147483647, -2147483647, -2147483648,
];

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return String(value);
}

let digest = 0;
let lines = 0;
function note(label: string, parts: unknown[]): void {
  const text = label + " " + parts.map(show).join(",");
  for (let i = 0; i < text.length; i++) digest = (Math.imul(digest, 31) + text.charCodeAt(i)) | 0;
  if (lines++ % 97 === 0) console.log(text);
}

class Holder {
  count = 0.5;
  whatever: unknown = null;
}
const holder = new Holder();
const table: number[] = [10.5, 11.5, 12.5, 13.5, 14.5, 15.5, 16.5, 17.5];
const bytes = new Uint8Array([20, 21, 22, 23, 24, 25, 26, 27]);
const letters = "abcdefgh";

function byVariable(x: number, y: number): void {
  const a = x | 0, b = y | 0;
  note("bits", [(a % b) | 0, (a % b) >>> 0, (a % b) & 7, ~(a % b), (a % b) << 1, (a % b) >> 1, (a % b) ^ 5]);
  note("equal", [a % b === 0, a % b === 1, a % b === -1, a % b !== 0, a % b == 2, a % b != -2, 0 === a % b, 3 === a % b]);
  note("order", [a % b < 0, a % b <= 0, a % b > 0, a % b >= 0, a % b < 2, 2 < a % b, -2 <= a % b, a % b >= b, a < a % b]);
  note("truth", [a % b ? 1 : 2, !(a % b), !!(a % b), (a % b && 7), (a % b || 8)]);
  note("number", [a % b, 1 / (a % b), Object.is(a % b, -0), Object.is(a % b, 0), Number.isNaN(a % b), -(a % b), Math.abs(a % b), Math.sign(a % b)]);
  note("sum", [a % b + 0, 0 + a % b, a % b + 3, 3 + a % b, 3 - a % b, a % b - 3, a % b - 0, 0 - a % b, a % b + b, b - a % b, (a % b + a) | 0]);
  note("product", [(a % b) * 0, (a % b) * 3, (a % b) * -3, (a % b) * b, ((a % b) * 5) | 0, (a % b) / 2, 2 / (a % b)]);
  note("two", [a % b === b % a, a % b < b % a, a % b + b % a, (a % b) % (b % a)]);
  note("index", [table[a % b], bytes[a % b], letters[a % b], letters.charCodeAt(a % b), table.at(a % b), a % b in table]);
  note("text", [String(a % b), `${a % b}`, "" + (a % b), (a % b).toString(), JSON.stringify([a % b])]);
  holder.count = a % b;
  holder.whatever = a % b;
  const made = [a % b, 1.5];
  made.push(a % b);
  note("stored", [holder.count, holder.whatever, made[0], made[2], made.length]);
  const copy = table.slice();
  copy[a % b] = 1;
  note("written", [copy.length, copy[0], copy[1], copy[7], Object.keys(copy).length]);
  const wide = a + b, wider = a - b;
  note("wide", [wide % b, (wide % b) | 0, wide % b === 0, wide % wider, (wide % wider) | 0, wide % wider ? 1 : 2, table[wide % b], wide % b + 1, 1 / (wide % wider)]);
}

function byConstants(x: number, y: number): void {
  const a = x | 0, wide = (x | 0) + (y | 0);
  note("by 1", [a % 1, (a % 1) | 0, a % 1 === 0, wide % 1, 1 / (a % 1)]);
  note("by 2", [a % 2, (a % 2) | 0, a % 2 === 0, a % 2 === 1, a % 2 === -1, a % 2 !== 0, a % 2 == 1, a % 2 ? 1 : 2, a % 2 === 2, wide % 2, wide % 2 === 1, wide % 2 === -1, wide % 2 === 0, table[a % 2], a % 2 + 1]);
  note("by 3", [a % 3, (a % 3) | 0, a % 3 === 0, a % 3 === 2, a % 3 === -2, a % 3 < 0, a % 3 ? 1 : 2, wide % 3, (wide % 3) | 0, wide % 3 === 0, wide % 3 === -1, table[wide % 3], 1 / (wide % 3)]);
  note("by 4", [a % 4, a % 4 === 3, a % 4 === -3, a % 4 === -1, a % 4 === 4, a % 4 === -4, wide % 4, wide % 4 === 3, wide % 4 === -3]);
  note("by 7", [a % 7, (a % 7) | 0, a % 7 === 6, wide % 7, (wide % 7) | 0, wide % 7 + 7, 7 - wide % 7]);
  note("by 8", [a % 8, (a % 8) & 3, a % 8 === 7, a % 8 === -7, wide % 8, bytes[a % 8], bytes[wide % 8]]);
  note("by 10", [a % 10, (a % 10) | 0, a % 10 === 0, wide % 10, (wide % 10) | 0, String(wide % 10)]);
  note("by 16", [a % 16, wide % 16, a % 16 === 15, a % 16 === -15]);
  note("by 1000", [a % 1000, wide % 1000, (wide % 1000) | 0]);
  note("by 1024", [a % 1024, wide % 1024, a % 1024 === 1023, wide % 1024 === -1023]);
  note("by 65536", [a % 65536, wide % 65536, (wide % 65536) | 0]);
  note("by 1073741824", [a % 1073741824, wide % 1073741824, a % 1073741824 === 1, a % 1073741824 === -1073741823]);
  note("by 2147483647", [a % 2147483647, wide % 2147483647, (wide % 2147483647) | 0, a % 2147483647 === 0]);
  note("by 2147483648", [a % 2147483648, wide % 2147483648, (wide % 2147483648) | 0, a % 2147483648 === 0]);
  note("by 4294967296", [a % 4294967296, wide % 4294967296, (wide % 4294967296) | 0, wide % 4294967296 === 0]);
  note("by 1000000007", [a % 1000000007, wide % 1000000007, (wide % 1000000007) | 0]);
  note("by -1", [a % -1, (a % -1) | 0, a % -1 === 0, wide % -1, 1 / (a % -1), 1 / (wide % -1)]);
  note("by -2", [a % -2, a % -2 === 1, a % -2 === -1, a % -2 === 0, wide % -2, wide % -2 === 1]);
  note("by -3", [a % -3, (a % -3) | 0, wide % -3, (wide % -3) | 0, wide % -3 === 0]);
  note("by -8", [a % -8, a % -8 === 7, a % -8 === -7, wide % -8]);
  note("by -2147483648", [a % -2147483648, (a % -2147483648) | 0, a % -2147483648 === 0, wide % -2147483648]);
  note("by 0", [a % 0, (a % 0) | 0, a % 0 === 0, a % 0 !== 0, a % 0 < 1, a % 0 ? 1 : 2, table[a % 0], a % 0 + 1, wide % 0, (wide % 0) | 0]);
}

function negated(x: number, y: number): void {
  const a = x | 0, b = y | 0, wide = (x | 0) + (y | 0);
  note("negated", [-a, 1 / -a, (-a) | 0, (-a + b) | 0, (b - -a) | 0, (-a - b) | 0, (-a * b) | 0, (-a * -b) | 0, -a + b, -a - b, -a * b, -a >>> 0, ~-a, -(-a), (-(-a)) | 0]);
  note("negated wide", [-wide, 1 / -wide, (-wide) | 0, (-wide + b) | 0, (-wide * 3) | 0, -wide + 0, -wide - 0, 0 - -wide]);
  note("negated index", [table[-a], bytes[-a], letters[-a], table[-(a % 8)], table[-a % 8], bytes[-wide], table[-a + 3], table[3 - -a]]);
  note("negated remainder", [-(a % b), (-(a % b)) | 0, -(a % 3), (-(a % 3) + b) | 0, -a % b, (-a % b) | 0, -a % 4 === -3, -a % 4 === 3, a % -b, (a % -b) | 0, 1 / (-a % b), 1 / -(a % 4)]);
}

function greatestCommonDivisor(a: number, b: number): number {
  while (b) {
    const rest = a % b;
    a = b;
    b = rest;
  }
  return a;
}

for (const x of integers) {
  for (const y of integers) {
    byVariable(x, y);
    byConstants(x, y);
    negated(x, y);
    note("gcd", [greatestCommonDivisor(x, y), greatestCommonDivisor(x | 0, y | 0)]);
  }
}
console.log(lines, digest);
