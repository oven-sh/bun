// Counters that start at integers of any size and end at sums and differences of integers: round 2^31, 2^32 and 2^53, up and down, as keys and as numbers.
let log = "";
function show(...values: any[]): void { for (const v of values) log += (Object.is(v, -0) ? "-0" : typeof v === "object" && v ? JSON.stringify(v) : String(v)) + ","; log += ";"; }
const parse = (text: string): any => JSON.parse(text);
const values: number[] = parse("[5,17,-3,0,7,19,23,100000,3,4,11,12,13,14,15,16,1,2,3,4]");
const doubles: number[] = parse("[5.5,17,-3,0.25,7,19,23,100000,3,4,11,12]");
const bytes = new Uint8Array(values);
function window(list: number[], from: number, to: number): number { let total = 0; for (let i = from; i < to; i++) total += list[i]; return total; }
function windowBytes(list: Uint8Array, from: number, to: number): number { let total = 0; for (let i = from; i < to; i++) total = total * 2 + list[i]; return total; }
function plus(list: number[], from: number): number { let total = 0; for (let i = from + 1; i < from + 4; i++) total += list[i] ?? 9; return total; }
function minus(list: number[], to: number): number { let total = 0; for (let i = to - 3; i < to - 1; i++) total += list[i] ?? 8; return total; }
function last(list: number[], from: number, to: number): number { let total = 0; for (let i = from; i <= to; i++) total = total * 3 + (list[i] ?? 7); return total; }
function between(from: number, to: number): string { let text = ""; for (let i = from; i < to; i++) text += i + " "; return text; }
function both(from: number, count: number): string { let text = ""; for (let i = from; i < from + count - 1; i++) text += i % 7 + " "; return text; }
function down(from: number, to: number): string { let text = ""; for (let i = from; i > to; i--) text += i + " "; return text; }
function twice(from: number): number { let total = 0; for (let i = from; i < from + from; i++) { total += i; if (total > 1e17 || i > from + 20) break; } return total; }
function stored(from: number, to: number): number[] { const list: number[] = []; for (let i = from; i < to; i++) list[i - from] = i * 2; return list; }
function text(string: string, from: number, to: number): string { let out = ""; for (let i = from; i < to; i++) out += string[i] + string.charCodeAt(i); return out; }
function nested(list: number[], size: number): number { let total = 0; for (let at = 0; at + size <= list.length; at += size) for (let i = at; i < at + size; i++) total = total * 2 + list[i]; return total; }
for (let round = 0; round < 3; round++) {
  let total = 0;
  for (let k = 0; k + 8 <= values.length; k += 4) total += window(values, k, k + 8);
  for (let k = 0; k + 4 < doubles.length; k++) total += window(doubles, k, k + 4) + plus(doubles, k) + minus(doubles, k + 2);
  for (let k = 0; k + 4 < bytes.length; k++) total += windowBytes(bytes, k, k + 4);
  for (let k = 0; k * 3 < values.length; k++) total += last(values, k, k * 3 - 1);
  show(total, nested(values, 3), nested(values, 7), nested(doubles, 4));
  for (const base of [0, 5, 2147483640, 2147483646, 2147483648, 4294967290, 4294967294, 4294967296, 9007199254740980, -5, -2147483650, -4294967299]) {
    for (let k = 0; k + 1 < 6; k++) show(between(base + k, base + k + 3), both(base + k, 4), down(base + k + 3, base + k), twice(base + k), stored(base + k, base + k + 3), window(values, base + k, base + k + 2), plus(values, base + k), minus(values, base + k), last(values, base + k, base + k + 1));
  }
  for (const from of [0.5, -0, NaN, 1.75, -1.5, "2" as any, null as any, undefined as any]) show(between(from, 4), both(from, 3), window(values, from, 4), plus(values, from), minus(values, from), last(values, from, 3), text("abcdef", from, 5));
  for (let k = 0; k + 2 <= 7; k++) show(text("abcdéf日", k, k + 2));
}
console.log(log.length, log);
