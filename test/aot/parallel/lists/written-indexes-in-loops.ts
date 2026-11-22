// Loops that read a list under written indexes: it is long enough, too short, empty, shortened on the way, of every kind, or the list that is stored into.
// STATISTIC: ArrayBoundsChecksHoisted >= 11
const n = JSON.parse("3") as number, log: string[] = [];
function convolve(a: number[], b: number[], c: number[]): number { for (let i = 0; i < 8; i++) { let s = 0; for (let k = 0; k < 3; k++) s += a[i + k] * b[k]; c[i] = s; } return c[2]; }
function line(a: number[], b: number[], c: number[]): number { for (let i = 0; i < c.length; i++) c[i] = a[i] * b[0] + b[1]; return c[1]; }
function sometimes(a: number[], b: number[], c: number[]): number { for (let i = 0; i < 8; i++) { let s = 0; for (let k = 0; k < 2; k++) s += i > n + 2 ? a[i + k] * b[4] : a[i + k]; c[i] = s; } return c[6]; }
function shortens(a: number[], b: number[], c: number[]): number { let s = 0; for (let i = 0; i < 8; i++) { let t = 0; for (let k = 0; k < 2; k++) t += a[k] * b[k + 1]; c[i] = t; s += t; if (i === n) b.length = 1; } return s; }
function storesIntoIt(a: number[], b: number[], c: number[]): number { for (let i = 0; i < 6; i++) { let s = 0; for (let k = 0; k < 3; k++) s += b[k]; b[i] = s + a[i]; c[i] = b[0]; } return b[5]; }
function polynomial(a: number[], b: number[], c: number[]): number { for (let i = 0; i < 8; i++) { const x = a[i]; c[i] = ((b[3] * x + b[2]) * x + b[1]) * x + b[0]; } return c[7]; }
const kinds: Record<string, () => any> = {
  doubles: () => Array.from({ length: n + 9 }, (_, i) => i * 1.25 - 2), ints: () => Array.from({ length: n + 9 }, (_, i) => i - 2), short: () => [1.5, 2.5], one: () => [n], none: () => [], holes: () => [1.5, , 2.5, , 4.5, 5.5, 6.5, 7.5, 8.5, 9.5], texts: () => ["1", "2", "3", "x", "5", "6", "7", "8", "9", "10"],
  late: () => [1, 2.5, 3, "4", 5, 6, 7, 8, 9, 10], room: () => new Array(10), frozen: () => Object.freeze([1.5, 2, 3, 4, 5, 6, 7, 8, 9, 10]), view: () => new Float64Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), bigints: () => [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n, 9n, 10n], nothing: () => undefined, far: () => { const list = [1.5, 2]; list[n + 90] = 1; return list; },
};
const show = (list: any) => (list === undefined ? "undefined" : list.length + ":" + Array.from({ length: Math.min(list.length, 12) }, (_, i) => (i in list ? (Object.is(list[i], -0) ? "-0" : String(list[i])) : "hole")).join());
const functions: Record<string, any> = { convolve, line, sometimes, shortens, storesIntoIt, polynomial };
for (let times = 0; times < 2; times++) {
  for (const name of Object.keys(functions)) {
    for (const kindOfA of Object.keys(kinds)) {
      for (const kindOfB of Object.keys(kinds)) {
        for (const kindOfC of ["doubles", "ints", "short", "holes", "same"]) {
          const a = kinds[kindOfA](), b = kinds[kindOfB](), c = kindOfC === "same" ? b : kinds[kindOfC]();
          let answer = "";
          try {
            answer = String(functions[name](a, b, c));
          } catch (error: any) {
            answer = error.name;
          }
          log.push(name + " " + kindOfA + " " + kindOfB + " " + kindOfC + ": " + answer + " " + show(b) + " " + show(c));
        }
      }
    }
  }
}
let sum = 0;
for (const text of log) for (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;
console.log(log.length, sum);
for (let i = 0; i < log.length; i += 7) console.log(log[i]);
