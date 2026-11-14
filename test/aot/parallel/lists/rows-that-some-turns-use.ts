// Tables whose rows some turns alone read or store into: longest common part, edit distance, shortest ways, packing, floods; rows of every kind.
// STATISTIC: RowsCheckedInStoringIterations >= 3
// STATISTIC: ArrayRowsHoisted >= 30
function commonPart(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = TEXT[y] === OTHER[x] ? o[y - 1][x - 1] + 1 : Math.max(o[y - 1][x], o[y][x - 1]); return 0;
}
function commonArms(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) { if (TEXT[y] === OTHER[x]) o[y][x] = o[y - 1][x - 1] + 1; else o[y][x] = Math.max(o[y - 1][x], o[y][x - 1]); } return 0;
}
function distance(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) { const c = TEXT[y] === OTHER[x] ? 0 : 1; o[y][x] = Math.min(o[y - 1][x] + 1, o[y][x - 1] + 1, o[y - 1][x - 1] + c); } return 0;
}
function someTurns(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) if (x & 1) o[y][x] = o[y - 1][x] + 1; return 0;
}
function someReads(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = x & 1 ? o[y - 1][x - 1] + 1 : Math.max(o[y - 1][x], o[y][x - 1]); return 0;
}
function eitherRow(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = x & 1 ? g[y][x] * 2 : h[y][x] / 2; return 0;
}
function equalElements(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = g[y][x] === g[x][y] ? 1 : 2; return 0;
}
function shorter(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let k = 0; k < n; k++) for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) { const d = o[y][k] + o[k][x]; if (d < o[y][x]) o[y][x] = d; } return 0;
}
function pack(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  const f = g[1]; for (let k = 0; k < n; k++) { const w = h[k][1] & 3, v = h[k][2]; for (let c = 4; c >= w; c--) f[c] = Math.max(f[c], f[c - w] + v); } return 0;
}
function twoRows(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  let a = g[0]; for (let y = 1; y < n; y++) { const b = o[y]; for (let x = 1; x < m; x++) b[x] = Math.min(a[x] + 1, b[x - 1] + 1, a[x - 1] + (TEXT[y] === OTHER[x] ? 0 : 1)); a = b; } return 0;
}
function newRows(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  const d: number[][] = []; for (let y = 0; y < n; y++) d.push(new Array<number>(m).fill(0)); for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) d[y][x] = Math.max(d[y - 1][x], d[y][x - 1]) + g[y][x]; return show(d);
}
function missingRow(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 0; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = y > 0 ? o[y - 1][x - 1] + 1 : x; return 0;
}
function lastRow(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 0; y < n; y++) for (let x = 0; x < m; x++) if (x === 3) o[y + 1][x] = g[y][x] + 0.5; else if (x === 2) o[y][x] = 7; return 0;
}
function counts(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let i = 0; i < n * m; i++) { const a = g[i % n], b = i % m; if (a[b] > 2) o[i % n][b]++; } return 0;
}
function floods(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  const stack: number[][] = [[1, 1]]; let k = 0; while (stack.length && k < 40) { const [y, x] = stack.pop() as [number, number]; if (y < 0 || x < 0 || y >= n || x >= m || o[y][x] === -1) continue; o[y][x] = -1; k++; stack.push([y + 1, x], [y, x + 1], [y - 1, x]); } return k;
}
function fractions(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = x & 1 ? o[y - 1][x] + 0.5 : o[y][x - 1] - 1; return 0;
}
function notNumbers(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) o[y][x] = x & 1 ? (g[y][x] - 1) / (x - 1) : g[y][x] - Infinity; return 0;
}
function replaces(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) { if (x & 1) o[y][x] = o[y - 1][x] + 1; if (x === 2 && y === 1) o[y] = [9, 9, 9, 9, 9]; } return 0;
}
function calls(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  for (let y = 1; y < n; y++) for (let x = 1; x < m; x++) { o[y][x] = x & 1 ? o[y - 1][x] + 1 : 3; touch(o, y); } return 0;
}
function guarded(g: number[][], o: number[][], h: number[][], n: number, m: number): any {
  try { for (let y = 1; y < n + 1; y++) for (let x = 1; x < m; x++) o[y][x] = x & 1 ? o[y - 1][x] + 1 : g[y][x]; } catch (error: any) { return error.name; } return 0;
}
const TEXT = JSON.parse('"kitten sits"'), OTHER = JSON.parse('"sitting kit"');
let touched = 0;
function touch(o: any, y: any) {
  touched++;
  if (touched % 5 === 0) o[y].length = 3;
  if (touched % 7 === 0) o[y][1] = "t";
  if (touched % 11 === 0) o[y] = o[0];
}
let shared: any[] = [];
const kinds: Record<string, () => any> = {
  "ints": () => [1, 2, 3, 4, 5],
  "doubles": () => [0.5, 1.5, 2.5, 3.5, 4.5],
  "late double": () => [1, 2, 3, 4, 5.5],
  "whole doubles": () => (() => { const l: any[] = [0.5, 2, 3, 4, 5]; l[0] = 1; return l; })(),
  "mixed": () => [1, "2", null, 4.5, undefined],
  "texts": () => ["a", "b", "c", "d", "e"],
  "holes": () => [1, , 3, , 5],
  "holes of doubles": () => [0.5, , 2.5, , 4.5],
  "short": () => [1, 2],
  "short doubles": () => [0.5],
  "empty": () => [],
  "room": () => new Array(5),
  "filled": () => new Array(5).fill(0),
  "frozen": () => Object.freeze([1, 2, 3, 4, 5]),
  "missing": () => undefined,
  "text": () => "01234",
  "view": () => new Float64Array(5),
  "bytes": () => new Uint8Array([250, 251, 252, 253, 254]),
  "one for all": () => shared,
  "far": () => [2147483647, 2147483648, -2147483649, 1073741824, 3],
  "zeros": () => [-0, 0, NaN, Infinity, 1],
  "objects": () => [{ valueOf() { touched += 10; return 3; } }, 2, 3, 4, 5],
  "bigints": () => [1n, 2n, 3n, 4n, 5n],
  "accessor": () => Object.defineProperty([1, 2, 3, 4, 5], 2, { get() { touched += 100; return 8; }, set() { touched += 1000; } }),
  "own prototype": () => Object.setPrototypeOf([1, , 3, 4], Object.create(Array.prototype, { 1: { value: 9, writable: true }, 4: { set() { touched += 5000; } } })),
};
const functions: Record<string, (g: any, o: any, h: any, n: number, m: number) => any> = { commonPart, commonArms, distance, someTurns, someReads, eitherRow, equalElements, shorter, pack, twoRows, newRows, missingRow, lastRow, counts, floods, fractions, notNumbers, replaces, calls, guarded };
const word = (value: any): string => (Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? "'" + value : value !== null && typeof value === "object" ? "{}" : String(value));
function showRow(row: any): string {
  if (!row || typeof row !== "object") return String(row);
  const all: string[] = [];
  for (let i = 0; i < Math.min(row.length, 8); i++) all.push(i in row ? word(row[i]) : "hole");
  return row.length + ":" + all.join();
}
const show = (rows: any[]) => rows.map(showRow).join(";");
const log: string[] = [], n = JSON.parse("4"), m = JSON.parse("5");
let numberOfCase = 0;
for (let times = 0; times < 2; times++) {
  for (const kind of Object.keys(kinds)) {
    for (const other of ["ints", "doubles", kind]) {
      for (const mine of ["ints", "doubles", kind]) {
        for (const name of Object.keys(functions)) {
          if (numberOfCase++ % 11) continue;
          shared = [1, 2, 3, 4, 5];
          touched = 0;
          const g: any[] = [], o: any[] = [], h: any[] = [];
          for (let y = 0; y < 5; y++) {
            g.push(kinds[mine]!());
            o.push(y === 2 ? kinds[kind]!() : kinds[other]!());
            h.push(kinds[other]!());
          }
          let answer: any;
          try {
            answer = functions[name]!(g, o, h, n, m);
          } catch (error: any) {
            answer = error.name;
          }
          log.push(name + " " + kind + " " + other + " " + mine + ": " + answer + " " + show(o) + " | " + show(g) + " | " + show(h) + " " + touched);
        }
      }
    }
  }
}
let sum = 0;
for (const line of log) for (let i = 0; i < line.length; i++) sum = (sum * 31 + line.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
