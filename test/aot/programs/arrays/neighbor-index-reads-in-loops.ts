// Loops that read or write the neighbours of their index: a[i - 1], a[i + 1], a[i - 2], going up and going down, from starts and to ends at which the neighbour is inside the array and at which it is not; over arrays that shrink or grow on the way.
declare const console: { log(...values: unknown[]): void };
function show(v: number | undefined): number { return v === undefined ? 1000000 : v; }
function differences(a: number[]): number { let t = 0; for (let i = 1; i < a.length; i++) t += (a[i] - a[i - 1]) * i; return t; }
function differencesFromTwo(a: number[]): number { let t = 0; for (let i = 2; i < a.length; i++) t += a[i] - a[i - 1] + a[i - 2]; return t; }
function fromZero(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += show(a[i - 1]) + a[i]; return t; }
function ahead(a: number[]): number { let t = 0; for (let i = 0; i < a.length; i++) t += show(a[i + 1]) + a[i]; return t; }
function aheadToLast(a: number[]): number { let t = 0; for (let i = 0; i < a.length - 1; i++) t += a[i + 1] * a[i]; return t; }
function downAhead(a: number[]): number { let t = 0; for (let i = a.length - 2; i >= 0; i--) t += a[i + 1] - a[i] * 2; return t; }
function downAheadFromLast(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) t += show(a[i + 1]) + a[i]; return t; }
function downBehind(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 1; i--) t += a[i - 1] + a[i] * 3; return t; }
function downBehindToZero(a: number[]): number { let t = 0; for (let i = a.length - 1; i >= 0; i--) t += show(a[i - 1]) + a[i]; return t; }
function shiftUp(a: number[]): number { for (let i = a.length - 1; i > 0; i--) a[i] = a[i - 1]; return a.length ? a[a.length - 1] + a[0] : -1; }
function shiftDown(a: number[]): number { for (let i = 1; i < a.length; i++) a[i - 1] = a[i]; return a.length ? a[a.length - 1] + a[0] : -1; }
function isSorted(a: number[]): boolean { for (let i = 1; i < a.length; i++) if (a[i - 1] > a[i]) return false; return true; }
function shrinking(a: number[]): number { let t = 0; for (let i = 1; i < a.length; i++) { t += show(a[i - 1]) + show(a[i]); if (i === 2) a.length = 4; if (i === 3) a.length = 1; } return t; }
function growing(a: number[]): number { let t = 0; for (let i = 1; i < a.length && i < 12; i++) { t += a[i - 1]; if (i & 1) a.push(i + 0.5); } return t; }
function texts(a: string[]): string { let t = ""; for (let i = 1; i < a.length; i++) t += a[i - 1] + a[i]; return t; }
function wrapping(a: number[]): number { let t = 0; for (let i = 1; i < a.length; i = (i + 1) | 0) t += a[i - 1]; return t; }
const halves = (n: number): number[] => Array.from({ length: n }, (_, i) => i * i + 0.5);
for (const n of [0, 1, 2, 3, 4, 5, 9, 100]) {
  console.log(n, differences(halves(n)), differencesFromTwo(halves(n)), fromZero(halves(n)), ahead(halves(n)), aheadToLast(halves(n)), downAhead(halves(n)), downAheadFromLast(halves(n)), downBehind(halves(n)), downBehindToZero(halves(n)));
  console.log(n, shiftUp(halves(n)), shiftDown(halves(n)), isSorted(halves(n)), isSorted(halves(n).reverse()), shrinking(halves(n)), growing(halves(n)), wrapping(halves(n)), texts(halves(n).slice(0, 4).map(String)));
}
