// The function that makes the array reads it too, and keeps it: what the reads know of a literal they know of the array that stands in its place.
const kept: unknown[] = [];
let total = 0;
function byIndex(i: number): number[] { const a = [10, 20, 30]; total += a[i % 3] + a[0] + a.length; kept[0] = a; return a; }
function fractions(i: number): number[] { const a = [0.5, 1.5, 2.5, 3.5]; total += a[i & 3] * 2; kept[1] = a; return a; }
function words(i: number): string[] { const a = ["zero", "one", "two"]; total += a[i % 3].length; kept[2] = a; return a; }
function mixed(i: number): (number | null | boolean)[] { const a = [1, null, true, 4]; const v = a[i & 3]; total += typeof v === "number" ? v : v === null ? 7 : 9; kept[3] = a; return a; }
function walked(): number[] { const a = [1, 2, 3, 4, 5]; for (const v of a) total += v; for (let i = 0; i < a.length; i++) total += a[i]; kept[4] = a; return a; }
function asked(v: number): number[] { const a = [3, 5, 7]; if (a.includes(v)) total++; total += a.indexOf(v) + a.lastIndexOf(v); kept[5] = a; return a; }
function outside(i: number): number[] { const a = [1, 2]; const v = a[i]; total += v === undefined ? 100 : v; kept[6] = a; return a; }
function taken(): number[] { const a = [6, 7, 8]; const [x, , z] = a; total += x + z + Math.max(...a); kept[7] = a; return a; }
function branch(c: boolean, i: number): number[] { const a = c ? [1, 2, 3] : [4, 5, 6]; total += a[i % 3]; kept[8] = a; return a; }
function handed(i: number): number[] { const a = [9, 8, 7]; total += reads(a, i); kept[9] = a; return a; }
function reads(a: number[], i: number): number { return a[i % a.length] + a.length; }
function inLoop(n: number): number[][] { const all: number[][] = []; for (let i = 0; i < n; i++) { const a = [i & 0, 1, 2]; const b = [5, 6]; total += a[i % 3] + b[i & 1]; all.push(b); } return all; }
for (let i = 0; i < 3000; i++) { byIndex(i); fractions(i); words(i); mixed(i); walked(); asked(i % 9); outside(i % 4); taken(); branch((i & 1) === 0, i); handed(i); }
const many = inLoop(50);
console.log(total, JSON.stringify(kept), many.length, new Set(many).size, byIndex(1) !== byIndex(1));
(kept[0] as number[])[0] = -1; (kept[2] as string[]).push("three"); many[0][0] = -5;
console.log(JSON.stringify([kept[0], kept[2], many[0], many[1], byIndex(0), words(0), inLoop(1)]));
