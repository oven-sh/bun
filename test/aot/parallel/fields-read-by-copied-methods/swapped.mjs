// Methods copied into loops that read an array out of a field in some iterations: swapped.
function leaf(x) { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(x)) : typeof x === "object" && x !== null ? (Array.isArray(x) ? "[" + x.map(leaf).join() + "]" : "object") : `${typeof x}:${String(x)}`; }
const lists = [() => [1, 2, 3, 4, 5, 6, 7, 8, 9], () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5], () => [1, , 3, 4, , 6, 7, 8, 9], () => [1.5, , 3.5, 4, , 6, 7, 8, 9], () => ["a", 2, 3, null, 5, undefined, 7, 8, 9], () => [1, 2], () => [], () => JSON.parse("[1,2,3,4.5,5,6,7,8,9]"), () => Float64Array.of(1.5, 2, 3, 4, 5, 6, 7, 8, 9), () => Int32Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9), () => "textoftxt", () => null, () => undefined, () => ({ 0: 1, 1: 2, length: 2 }), () => Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9]), () => [NaN, -0, 1e300, 4, 5, 6, 7, 8, 9], () => [{ valueOf() { return 3; } }, 2, 3, 4, 5, 6, 7, 8, 9]];
class Grid { constructor(w, h, cells, other) { this.w = w; this.h = h; this.cells = cells; this.other = other; } get(x, y) { if (x === 2) this.cells = this.other; return x > 0 ? this.cells[x] : 0; } }
class Below extends Grid { get(x, y) { return super.get(x, y); } }
let poking = 0;
const pokes = [g => { ; }, g => { if (g.cells && typeof g.cells === "object") g.cells[4] = "t"; }, g => { g.cells = [9.5, 8.5, 7.5, 6.5, 5.5, 4.5, 3.5, 2.5, 1.5]; }, g => { g.cells = null; }, g => { if (Array.isArray(g.cells) && !Object.isFrozen(g.cells)) g.cells.length = 3; }, g => { Object.defineProperty(g, "cells", { get() { return [7, 7, 7, 7, 7, 7, 7, 7, 7]; }, configurable: true }); }, g => { delete g.cells; }, g => { if (Array.isArray(g.cells) && !Object.isFrozen(g.cells)) g.cells[40] = 1; }, g => { g.get = () => 5; }];
function poke(g) { pokes[poking](g); }
function sum(g) { let s = 0; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) s += g.get(x - 1, y) + g.get(x + 1, y); return s; }
function text(g) { let s = ""; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) s += leaf(g.get(x, y)) + ","; return s; }
function bits(g) { let s = 0; for (let x = 0; x < 9; x++) s = (s + g.get(x, 0)) | 0; return s; }
function most(g) { let m = -1e9; for (let x = 0; x < 5; x++) { const v = g.get(x, 1); if (v > m) m = v; } return m; }
function own(g) { let s = 0; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) { s += g.get(x, y); if (x === 1 && y === 1) poke(g); s += g.get(x, y) * 2; } return s; }
function typedOnly() { const g = new Grid(3, 3, [1, 2, 3, 4, 5, 6, 7, 8, 9], [9, 8, 7]); let s = 0; for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) s += Number(g.get(x, y)); return s; }
for (let l = 0; l < lists.length; l++) {
  const out = [];
  for (const run of [sum, text, bits, most, own]) for (poking = 0; poking < (run === own ? pokes.length : 1); poking++) {
    for (const make of [Grid, Below]) {
      const g = new make(3, 3, lists[l](), [10, 20.5, 30]);
      if (l % 3 === 1) g.change = function () { this.cells = [5, "x", 7.5, 1, 2, 3, 4, 5, 6]; };
      let answer; try { answer = leaf(run(g)); } catch (e) { answer = e.constructor.name; }
      out.push(answer, leaf(g.cells));
    }
  }
  console.log(l, out.join(" "));
}
let fixed; try { fixed = typedOnly(); } catch (e) { fixed = e.constructor.name; } console.log(String(fixed));
