// new View(length) in loops: every kind, lengths about the limits of the cells, numbers that are whole and that are not; each is zero from end to end whatever its memory held before.
type View = Int8Array | Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array | Int32Array | Uint32Array | Float32Array | Float64Array;
const makers: ((length: number) => View)[] = [n => new Int8Array(n), n => new Uint8Array(n), n => new Uint8ClampedArray(n), n => new Int16Array(n), n => new Uint16Array(n), n => new Int32Array(n), n => new Uint32Array(n), n => new Float32Array(n), n => new Float64Array(n)];
const kept: View[] = [];
function sumOf(view: View): number { let sum = 0; for (let k = 0; k < view.length; k++) sum += view[k]; return sum; }
function soil(view: View): void { for (let k = 0; k < view.length; k++) view[k] = 85; }
function wholeLengths(make: (length: number) => View, most: number): string {
  let bad = 0, sum = 0;
  for (let n = 0; n <= most; n++) { const view = make(n); if (view.length !== n || sumOf(view) !== 0 || view.byteOffset !== 0) bad++; soil(view); sum += view.byteLength; if (n % 37 === 0) kept.push(view); }
  return bad + ":" + sum;
}
function bytes(most: number): string { let bad = 0, sum = 0; for (let n = 0; n <= most; n++) { const view = new Uint8Array(n); if (sumOf(view) !== 0 || view.length !== n) bad++; view.fill(255); sum += view.length; } return bad + ":" + sum; }
function floats(most: number): string { let bad = 0, sum = 0; for (let n = 0; n < most; n += 1) { const view = new Float64Array(n & 255); for (let k = 0; k < view.length; k++) { if (!Object.is(view[k], 0)) bad++; view[k] = n + 0.5; } sum += view.byteLength; } return bad + ":" + sum; }
function words(from: number, most: number): string { let bad = 0, sum = 0; for (let n = from; n < most; n++) { const view = new Uint32Array(n % 130); if (sumOf(view) !== 0) bad++; view.fill(0xffffffff); sum = (sum + view.length) | 0; } return bad + ":" + sum; }
function known(rounds: number): string { let sum = 0; for (let k = 0; k < rounds; k++) { const a = new Uint8Array(16), b = new Uint16Array(7), c = new Int32Array(33), d = new Float32Array(255), e = new Float64Array(128), f = new Uint8Array(1000), g = new Uint8Array(1001), h = new Int8Array(0), i = new Uint32Array(257), j = new Uint8ClampedArray(1); for (const v of [a, b, c, d, e, f, g, h, i, j]) { sum += sumOf(v) + v.length; soil(v); } } return String(sum); }
const lengths: any[] = [0, 1, 2.5, 3.999, -0, -0.5, NaN, undefined, null, "7", true, false, 1e3, 1000.5, 2 ** 20, "x", [], [5]];
function ofAny(values: any[]): string { const out: string[] = []; for (let k = 0; k < values.length; k++) { try { const view = new Uint16Array(values[k]); out.push(view.length + "/" + sumOf(view)); soil(view); } catch (error) { out.push((error as Error).name); } } return out.join(); }
function refused(values: number[]): string { const out: string[] = []; for (let k = 0; k < values.length; k++) { try { out.push(String(new Uint8Array(values[k]).length)); } catch (error) { out.push((error as Error).name + " " + (error as Error).message); } } return out.join("|"); }
function wholeRefused(from: number): string { const out: string[] = []; for (let n = from; n < from + 4; n++) { try { out.push(String(new Int32Array(n).length)); } catch (error) { out.push((error as Error).name + " " + (error as Error).message); } } return out.join("|"); }
const lines: string[] = [];
for (let round = 0; round < 6; round++) {
  for (let m = 0; m < makers.length; m++) lines.push(m + " " + wholeLengths(makers[m], 300 + round));
  lines.push(bytes(1040), floats(700), words(0, 400), known(20), ofAny(lengths), refused([-1, 2 ** 53, 1e20, -1.5, Infinity, 5]), wholeRefused(-3), wholeRefused(2147483640));
}
let total = 0; for (const view of kept) total += view.length; lines.push(kept.length + " " + total);
console.log(lines.slice(0, 18).join("\n")); console.log(lines.slice(-18).join("\n")); let hash = 7; for (const c of lines.join("\n")) hash = (hash * 31 + c.charCodeAt(0)) | 0; console.log(lines.length, hash);
