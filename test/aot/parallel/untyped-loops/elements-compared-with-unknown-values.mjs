// elements of lists of every kind held against values of every kind
let calls = 0; const all = process.argv.includes("all");
function ofGreater(x, w, h) { let n = 0; for (const v of x) if (v > w) n++; return n; }
function ofLess(x, w, h) { let n = 0; for (const v of x) { if (v < w) continue; n++; } return n; }
function ofBoth(x, w, h) { let n = 0; for (const v of x) if (v >= w && v <= h) n++; return n; }
function ofEqual(x, w, h) { let n = 0; for (const v of x) if (v === w) n++; return n; }
function ofOther(x, w, h) { let n = 0; for (const v of x) if (v !== w) n++; return n; }
function ofLoose(x, w, h) { let n = 0; for (const v of x) if (v == w) n++; return n; }
function ofLargest(x, w, h) { let m = x[0]; for (const v of x) if (v > m) m = v; return m; }
function ofLargestOr(x, w, h) { let m = w; for (const v of x) if (v > m) m = v; return m; }
function ofFirst(x, w, h) { for (const v of x) if (v > w) return v; return "none"; }
function ofPush(x, w, h) { const o = []; for (const v of x) if (v > w) o.push(v); return o; }
function ofSum(x, w, h) { let s = 0; for (const v of x) s += v > w ? 1 : 2; return s; }
function ofPrevious(x, w, h) { let n = 0, p = x[0]; for (const v of x) { if (v < p) n++; p = v; } return n; }
function byGreater(x, w, h) { let n = 0; for (let i = 0; i < x.length; i++) if (x[i] > w) n++; return n; }
function byBoth(x, w, h) { let n = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; if (v >= w && v <= h) n++; } return n; }
function byEqual(x, w, h) { let n = 0; for (let i = 0; i < x.length; i++) if (x[i] === w) n++; return n; }
function byOther(x, w, h) { let n = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; if (v !== w && v !== h) n++; } return n; }
function byRight(x, w, h) { let n = 0; for (let i = 0; i < x.length; i++) if (w < x[i]) n++; return n; }
function byHalves(x, w, h) { let a = 0, b = x.length; while (a < b) { const m = (a + b) >> 1; if (x[m] < w) a = m + 1; else b = m; } return a; }
function byLargest(x, w, h) { let m = x[0]; for (let i = 1; i < x.length; i++) if (x[i] > m) m = x[i]; return m; }
function byClamp(x, w, h) { for (let i = 0; i < x.length; i++) if (x[i] > w) x[i] = w; return x; }
function byNest(x, w, h) { let n = 0; for (let i = 0; i < x.length; i++) for (let j = 0; j < x.length; j++) if (x[i] > x[j] && x[j] !== w) n++; return n; }
function byChange(x, w, h) { let n = 0; for (let i = 0; i < x.length; i++) { if (x[i] > w) { n++; if (n === 2) w = h; } } return n; }
function called(x, w, h) { let n = 0; x.forEach(v => { if (v > w) n++; }); return n; }
function filtered(x, w, h) { return x.filter(v => v >= w).length + "," + x.findIndex(v => v > w) + x.some(v => v === w); }
function sorted(x, w, h) { const o = x.slice(); for (let i = 1; i < o.length; i++) { const v = o[i]; let j = i - 1; while (j >= 0 && o[j] > v) { o[j + 1] = o[j]; j--; } o[j + 1] = v; } return o; }
const bodies = { ofGreater, ofLess, ofBoth, ofEqual, ofOther, ofLoose, ofLargest, ofLargestOr, ofFirst, ofPush, ofSum, ofPrevious, byGreater, byBoth, byEqual, byOther, byRight, byHalves, byLargest, byClamp, byNest, byChange, called, filtered, sorted };
const values = { num: () => 4, frac: () => 4.5, nan: () => NaN, inf: () => Infinity, negzero: () => -0, str: () => "t4", numstr: () => "4", empty: () => "", undef: () => undefined, nul: () => null, bool: () => true, big: () => 4n, obj: () => ({ valueOf() { calls++; return 4; } }), objstr: () => ({ toString() { calls++; return "t4"; } }), arr: () => [4], date: () => new Date(4), throws: () => ({ valueOf() { calls++; throw new RangeError("v"); } }), sym: () => Symbol("s"), same: x => x[1] };
const lists = { doubles: () => Array.from({ length: 9 }, (_, i) => i + 0.5), ints: () => Array.from({ length: 9 }, (_, i) => i), mixed: () => Array.from({ length: 9 }, (_, i) => i & 1 ? i : i + 0.5), strings: () => Array.from({ length: 9 }, (_, i) => "t" + i), holes: () => (() => { const a = [1.5, , 3.5, 4.5, 5.5]; a.length = 8; return a; })(), inthole: () => [1, , 5, 4, 9], nans: () => [1.5, NaN, 4.5, NaN, 7], undefs: () => [1, undefined, 5, null, 4], objects: () => Array.from({ length: 5 }, (_, i) => ({ valueOf() { calls++; return i + 2; } })), bigs: () => [1n, 4n, 5n], kinds: () => [1, "t4", 4.5, true, null, "5", 4n, -0], late: () => [1, 2, 3, 5, 6, 7, "t9", 8], empty: () => [], view: () => new Float64Array([1, 4, 4.5, NaN, 9]), bytes: () => new Uint8Array([1, 4, 9]), text: () => "a4z", set: () => new Set([1, 4.5, 9]), like: () => ({ length: 3, 0: 1, 1: 4, 2: 9 }), negzeros: () => [0, -0, 4, -4] };
const show = v => { try { return Array.isArray(v) ? "[" + Array.from(v, show).join() + "]" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "o" : typeof v + ":" + String(v); } catch (e) { return "E" + e.name; } };
let total = 0;
for (const b in bodies) for (const k in values) {
  let hash = 0;
  for (const l in lists) for (let round = 0; round < 2; round++) {
    let line = b + " " + k + " " + l;
    try { const x = lists[l](), w = values[k](x), got = bodies[b](x, w, round ? 7 : w); line += " " + show(got) + (b === "byClamp" ? show(x) : "") + " " + calls; } catch (e) { line += " " + e.name + " " + calls; }
    if (all) console.log(line);
    for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
    total++;
  }
  console.log(b, k, hash);
}
console.log(total, calls);
