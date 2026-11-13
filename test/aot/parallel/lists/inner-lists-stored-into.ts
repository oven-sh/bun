// Inner loops of a few turns that store into lists which the loop around reads: rows, fields of objects, flat lists; lists of every kind, rows that are missing, short, frozen or one list for all.
// STATISTIC: StoringLoopsNotUnrolled >= 40
class Item { constructor(public list: number[]) {} }
class Holder {
  next: number[][];
  flat: number[];
  view = new Float64Array(20);
  items: Item[];
  constructor(public rows: number[][]) {
    this.next = [];
    for (let y = 0; y < 5; y++) this.next.push([0, 0, 0, 0, 0]);
    this.flat = ([] as number[]).concat(...rows.slice(0, 4));
    this.items = [new Item([1, 2, 3]), new Item([0.5, 1.5]), new Item([])];
  }
}
let touched = 0;
function touch(h: Holder, y: number) {
  touched++;
  if (touched % 5 === 0) h.rows[y]!.length = 2;
  if (touched % 7 === 0) (h.rows as any)[y][1] = "t";
  if (touched % 11 === 0) h.rows[y] = h.rows[0]!;
}
function addsToRows(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.rows[y]![x]! += d; return 0;
}
function copiesRows(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.next[y]![x] = h.rows[y]![x]!; return 0;
}
function addsToRow(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) { const row = h.rows[y]!; for (let x = 0; x < 5; x++) row[x]! += d; } return 0;
}
function addsFlat(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.flat[y * 5 + x]! += d; return 0;
}
function storesProducts(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.rows[y]![x] = x * y + d; return 0;
}
function storesOnce(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) { for (let x = 0; x < 3; x++) if (x === y) h.rows[y]![x] = d; } return 0;
}
function sumsThenStores(h: Holder, d: number): number {
  let s = 0; for (let y = 0; y < 4; y++) { let t = 0; for (let x = 0; x < 5; x++) { t += h.rows[y]![x]!; h.next[y]![x] = t; } s += t; } return s;
}
function threeDeep(h: Holder, d: number): number {
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { let t = 0; for (let k = 0; k < 3; k++) t += h.rows[y]![k]! * h.rows[k]![x]!; h.next[y]![x] = t; } return 0;
}
function transposes(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < y; x++) { const t = h.rows[y]![x]!; h.rows[y]![x] = h.rows[x]![y]!; h.rows[x]![y] = t; } return 0;
}
function swapsRows(h: Holder, d: number): number {
  for (let y = 0; y < 2; y++) { const a = h.rows[y]!, b = h.rows[3 - y]!; for (let x = 0; x < 5; x++) { const t = a[x]!; a[x] = b[x]!; b[x] = t; } } return 0;
}
function replacesRow(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) { h.rows[y]![x] = d; if (x === 2 && y === 1) h.rows[y] = [9, 9, 9, 9, 9]; } return 0;
}
function growsRow(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 7; x++) h.rows[y]![x] = d + x; return 0;
}
function backwards(h: Holder, d: number): number {
  for (let y = 3; y >= 0; y--) for (let x = 4; x >= 0; x--) h.rows[y]![x]! -= d; return 0;
}
function breaks(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) { if (h.rows[y]![x]! > 6) break; h.rows[y]![x] = d; } return 0;
}
function view(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 5; x++) h.view[y * 5 + x]! += d; return h.view[7]!;
}
function fresh(h: Holder, d: number): number {
  const made: number[][] = []; for (let y = 0; y < 4; y++) { const row = [0, 0, 0, 0, 0]; for (let x = 0; x < 5; x++) row[x] = h.rows[y]![x]! + d; made.push(row); } h.next = made; return 0;
}
function items(h: Holder, d: number): number {
  for (const item of h.items) for (let x = 0; x < 3; x++) item.list[x]! += d; return h.items[0]!.list[1]!;
}
function calls(h: Holder, d: number): number {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { h.rows[y]![x]! += d; if (x === 1) touch(h, y); } return 0;
}
let shared: number[] = [];
const kinds: Record<string, () => number[]> = {
  "ints": () => [1, 2, 3, 4, 5],
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5],
  "late doubles": () => [1, 2, 3, 4, 5.5],
  "mixed": () => [1, "2", null, 4.5, undefined] as any,
  "texts": () => ["a", "b", "c", "d", "e"] as any,
  "holes": () => [1, , 3, , 5] as any,
  "short": () => [1, 2],
  "empty": () => [],
  "room": () => new Array(5),
  "frozen": () => Object.freeze([1, 2, 3, 4, 5]) as any,
  "missing": () => undefined as any,
  "text": () => "01234" as any,
  "view": () => new Uint8Array([250, 251, 252, 253, 254]) as any,
  "one for all": () => shared,
  "far": () => [2147483647, 2147483646, 4, 5, 6],
  "objects": () => [{ valueOf() { return 3; } }, 2, 3, 4, 5] as any,
  "accessor": () => Object.defineProperty([1, 2, 3, 4, 5], 2, { get() { touched += 100; return 8; }, set() { touched += 1000; } }),
};
const functions: Record<string, (h: Holder, d: number) => number> = { addsToRows, copiesRows, addsToRow, addsFlat, storesProducts, storesOnce, sumsThenStores, threeDeep, transposes, swapsRows, replacesRow, growsRow, backwards, breaks, view, fresh, items, calls };
const steps: number[] = JSON.parse("[1, 0.5, -3, 2147483647]");
const word = (value: any): string => (Object.is(value, -0) ? "-0" : typeof value === "string" ? "'" + value : value !== null && typeof value === "object" ? "{}" : String(value));
const show = (rows: any[]): string => rows.map(row => (row && typeof row === "object" ? Array.from(row as any[], word).join() : String(row))).join(";");
const log: string[] = [];
let numberOfCase = 0;
for (let times = 0; times < 2; times++) {
  for (const kind of Object.keys(kinds)) {
    for (const other of ["ints", "doubles", kind]) {
      for (const d of steps) {
        for (const name of Object.keys(functions)) {
          if (numberOfCase++ % 3) continue;
          shared = [1, 2, 3, 4, 5];
          touched = 0;
          const rows: number[][] = [];
          for (let y = 0; y < 5; y++) rows.push(y === 2 ? kinds[kind]!() : kinds[other]!());
          let answer: any, h: Holder | undefined;
          try {
            h = new Holder(rows);
            answer = functions[name]!(h, d);
          } catch (error: any) {
            answer = error.name;
          }
          log.push(name + " " + kind + " " + other + " " + d + ": " + answer + " " + (h ? show(h.rows) + " | " + show(h.next) + " | " + Array.from(h.flat as any[], word).join() + " | " + show(h.items.map(item => item.list)) : "") + " " + touched);
        }
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
