// Elements read below zero and above the end are undefined: every relation and equality of two of them, of one and a number, in and out of loops.
const views = [new Int32Array([5, -3, 0, 2147483647, -2147483648, 7]), new Uint8Array([0, 255, 3, 3]), new Int8Array([-128, 127, 0]), new Uint32Array([4294967295, 0, 1])];
const lists: number[][] = [[5, -3, 0, 7], [1.5, 2], [], [3, undefined as any, 4], [-0, 0]];
function all(a: ArrayLike<number>, b: ArrayLike<number>, i: number, j: number): string {
  const x = a[i]!, y = b[j]!;
  return [x < y, x <= y, x > y, x >= y, x === y, x !== y, x == y, x != y].map(Number).join("");
}
function ofViews(a: Int32Array, i: number, j: number): string {
  let out = "";
  if (a[i]! < a[j]!) out += "l"; if (a[i]! <= a[j]!) out += "L"; if (a[i]! > a[j]!) out += "g"; if (a[i]! >= a[j]!) out += "G"; if (a[i] === a[j]) out += "e"; if (a[i] !== a[j]) out += "n";
  return out;
}
function withNumber(a: Int32Array, i: number, x: number): string {
  let out = "";
  if (a[i]! < x) out += "l"; if (a[i]! <= x) out += "L"; if (a[i]! > x) out += "g"; if (a[i]! >= x) out += "G"; if (a[i] === x) out += "e"; if (x < a[i]!) out += "1"; if (x >= a[i]!) out += "2"; if (x !== a[i]) out += "3";
  return out;
}
function withConstants(a: Uint8Array, i: number): string { let out = ""; if (a[i]! > 3) out += "a"; if (a[i]! >= 3) out += "b"; if (a[i]! < 3) out += "c"; if (a[i]! <= 3) out += "d"; if (a[i] === 3) out += "e"; if (a[i] !== 3) out += "f"; if (3.5 > a[i]!) out += "g"; if (a[i] === undefined) out += "u"; return out; }
function insertion(a: Int32Array): string { for (let i = 1; i < a.length; i++) { const x = a[i]!; let j = i - 1; while (a[j]! > x) { a[j + 1] = a[j]!; j--; } a[j + 1] = x; } return a.join(); }
function find(list: number[], x: number | undefined): number { let k = 0; for (; k < 6; k++) if (list[k] === x) break; return k; }
function findInView(a: Int32Array, b: Int32Array, j: number): number { const x = b[j]; let k = 0; for (; k < 9; k++) if (a[k] === x) break; return k; }
let lines = "";
for (const a of [...views, ...lists]) for (const b of [...views, ...lists]) for (let i = -1; i < 7; i++) for (let j = -1; j < 7; j++) lines += all(a, b, i, j);
let hash = 0; for (let k = 0; k < lines.length; k++) hash = (hash * 31 + lines.charCodeAt(k)) | 0;
console.log(lines.length, hash);
const v = views[0] as Int32Array;
for (let i = -1; i < 8; i++) { let line = ""; for (let j = -1; j < 8; j++) line += ofViews(v, i, j) + " "; console.log(line); for (const x of [0, 5, -3, 2 ** 31, NaN, 1.5, undefined as any, -0, Infinity]) line = withNumber(v, i, x) + " " + line; console.log(line); console.log(withConstants(views[1] as Uint8Array, i)); }
console.log(insertion(new Int32Array([3, 1, 2])), insertion(new Int32Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, -1])), insertion(new Int32Array(0)));
for (const list of lists) console.log(find(list, 5), find(list, undefined), find(list, 0), find(list, 2), find(list, NaN), find(list, 4));
for (let j = -1; j < 8; j++) console.log(findInView(v, v, j), findInView(v, new Int32Array([7, 2147483647]), j));
