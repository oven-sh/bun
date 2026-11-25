// STATISTIC: RemaindersByHoistedReciprocal >= 6
function sums(d: number, offset: number, turns: number): string {
  let a = 0, b = 0, c = 0;
  for (let j = 0; j < turns; j++) {
    a = (a + ((j + offset) & 0x7fffffff) % d) | 0;
    b = (b * 31 + ((j + offset) >>> 0) % d) | 0;
    c = (c + j % d) | 0;
  }
  return a + " " + b + " " + c;
}
function signed(d: number, from: number, turns: number): string {
  let zeros = 0, s = 0;
  for (let j = 0; j < turns; j++) { const r = (j + from) % d; if (Object.is(r, -0)) zeros++; s += r; }
  return s + " " + zeros;
}
function each(d: number, list: number[]): string {
  let out = "";
  for (let k = 0; k < list.length; k++) out += ((list[k] >>> 0) % d) + ",";
  return out;
}
function top(d: number): number { let s = 0; for (let j = 0; j < 1000; j++) s = (s * 31 + (j + 4294966296) % d) | 0; return s; }
function beyond(d: number): number { let s = 0; for (let j = 0; j < 1000; j++) s = (s * 31 + (j + 4294967296) % d) | 0; return s; }
function far(d: number): number { let s = 0; for (let j = 0; j < 1000; j++) s = (s * 31 + (j + 4503599627370496) % d) | 0; return s; }
function product(d: number): number { let s = 0; for (let j = 0; j < 1000; j++) s = (s * 31 + (j * 4294967) % d) | 0; return s; }
const divisors = [1, 2, 3, 5, 7, 10, 64, 65535, 65536, 65537, 1000003, 1073741823, 1073741824, 1073741825, 2147483646, 2147483647];
const offsets = [0, 1, 65530, 1073741820, 2147483640, 2147483647, 4294967290, -6];
const edges = [0, 1, 2, 65535, 65536, 2147483646, 2147483647, 2147483648, 2147483649, 4294967294, 4294967295];
for (const d of divisors) {
  const told: string[] = [];
  for (const offset of offsets) told.push(sums(d, offset, 12));
  for (const near of [d - 3, d * 2 - 3, d * 3 - 3]) told.push(sums(d, near, 6));
  console.log(d, told.join(" | "), each(d, edges), signed(d, -7, 15), top(d), beyond(d), far(d), product(d));
}
for (const d of [0, -0, -1, -3, 0.5, 2.5, 2147483648, 4294967296, NaN, Infinity, -Infinity]) console.log(d, sums(d, 5, 9), each(d, edges), signed(d, -7, 15));
console.log(sums(7, 0, 0), sums(1, 0, 100000), sums(2147483647, 2147483000, 100000), sums(3, 0, 100000));
