// Nests that are unrolled and store into rows of which nothing is known: rows of doubles, of int32s, of both, and rows that are something else, through a holder that may be missing.
// STATISTIC: RowStoresOfEitherKind >= 2
class Holder { next: number[][]; constructor(public rows: number[][]) { this.next = []; for (let y = 0; y < 5; y++) this.next.push([0, 0, 0, 0, 0]); } }
function adds(h: Holder, d: number): number { for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.rows[y]![x]! += d; return 0; }
function takes(h: Holder, d: number): number { for (let y = 3; y >= 0; y--) for (let x = 4; x >= 0; x--) h.rows[y]![x]! -= d; return 0; }
function copies(h: Holder, d: number): number { for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.next[y]![x] = h.rows[y]![x]!; return d; }
function products(h: Holder, d: number): number { for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.rows[y]![x] = x * y + d; return 0; }
function swaps(h: Holder, d: number): number { for (let y = 0; y < 2; y++) { const a = h.rows[y]!, b = h.rows[3 - y]!; for (let x = 0; x < 5; x++) { const t = a[x]!; a[x] = b[x]!; b[x] = t; } } return d; }
function sums(h: Holder, d: number): number { let s = 0; for (let y = 0; y < 4; y++) { let t = 0; for (let x = 0; x < 5; x++) { t += h.rows[y]![x]!; h.next[y]![x] = t; } s += t; } return s + d; }
function width(h: Holder): number { return h.rows[0]!.length; }
function first(h: Holder): number { return h.rows[0]![0]!; }
const functions: Record<string, (h: Holder, d: number) => number> = { adds, takes, copies, products, swaps, sums, width, first };
const kinds: string[] = JSON.parse('["[1,2,3,4,5]", "[0.5,1.5,2.5,3.5,4.5]", "[1,2,3,4,5.5]", "[2147483647,2,-2147483648,4,5]", "[1,2,3]", "[]", "[1,\\"2\\",null,4.5,5]", "\\"01234\\"", "null", "{\\"0\\":1,\\"length\\":5}"]');
const steps: number[] = JSON.parse("[1, 0.5, -3, 2147483647, -0.0]");
const show = (value: any): string => value && typeof value === "object" ? "[" + Array.from(value.length === undefined ? Object.values(value) : value, show).join() + "]" : Object.is(value, -0) ? "-0" : String(value);
let sum = 0, lines = 0;
for (const a of kinds) for (const b of [kinds[0]!, kinds[1]!, a]) for (const d of steps) for (const name of Object.keys(functions)) {
  const rows: any[] = [a, b, a, b, b].map(text => JSON.parse(text));
  if (d === -3) rows[2] = Object.freeze(rows[2]); else if (d === 2147483647) rows[3] = rows[0]; else if (d === 0.5 && lines % 5 === 0) rows[1] = new Float64Array(5);
  let line = name + " " + a + " " + b + " " + d + ": ";
  const holder: any = lines % 37 === 36 ? undefined : new Holder(rows);
  for (let turn = 0; turn < 2; turn++) try { line += show(functions[name]!(holder, d)); } catch (error: any) { line += error.name; }
  line += " " + show(rows) + " " + show(holder?.next);
  for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
  if (lines++ % 29 === 0) console.log(line);
}
console.log(lines, sum);
