
const out = [];
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : v instanceof Error ? v.name + ":" + v.message : typeof v === "object" && v !== null ? (Array.isArray(v) ? "[" + v.map(show).join() + "]" : "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}") : typeof v === "string" ? JSON.stringify(v) : String(v);
function log(...v) { if (out.length < 4000) out.push(v.map(show).join(" ")); }
function frames(e) { return e instanceof Error ? e.name + ":" + e.message + " " + String(e.stack).split("\n").slice(1, 5).map(l => l.trim().replace(/^at /, "").replace(/ ?\(.*$/, "")).filter(l => /^[a-zA-Z0-9_.$]+$/.test(l) && !/module|unknown|native/.test(l)).join("<") : show(e); }
let done = 0, open = 0, state = 0, depth = 0; const errors = [], seen = [];
const whole = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => (k * 37) % 23).join() + "]");
const doubles = JSON.parse("[" + Array.from({ length: 24 }, (_, k) => ((k * 37) % 23) / 4).join() + "]");
const mixed = JSON.parse('[1,2,"3",4.5,null,5,[6],7,true,8,9,{"v":10},11,-1,12]');
const signed = JSON.parse('[3,-1,4,-1,5,-9,2,-6,5,3,-5]'), large = [2147483647, 1, -2147483648, 4294967295, 9007199254740991, 0.5, -0, NaN];
const views = [new Uint8Array([1, 200, 3, 4]), new Float64Array([0.5, -1, 3e9, NaN]), Buffer.from([7, 8, 9])];
const rows = JSON.parse('[[1,2],[3,"x"],[],[4.5,-1],null,[7,8]]');
const records = [{ v: 1, w: 2 }, { v: -3, w: 4 }, { w: 1, v: "t" }, { v: 2.5, get w() { state++; return 3; } }, null, { v: 7 }];
const trap = new Proxy({}, { getPrototypeOf() { state++; whole.push(1); return Error.prototype; } });
class Own extends Error { constructor(m, v) { super(m); this.v = v; } }
class Lock { constructor(n) { this.n = n; open++; } read() { return this.n; } [Symbol.dispose]() { open--; if (this.n === 5) state++; } }
function positive(v) { if (v < 0) throw new RangeError("negative " + v); return v + 1; }
function strict(v) { if (typeof v !== "number") throw new TypeError("no number " + typeof v); return v * 2; }
function rare(v) { if (v === 7) throw new Own("seven", v); if (v === 4) throw "text"; if (v === 9) throw null; return v; }
function index(vs, k) { if (k >= vs.length) throw new RangeError("out " + k); return vs[k]; }
function deep(v, n) { return n > 0 ? deep(v + 1, n - 1) : positive(v); }
function f0(v) { let s = 2; try { try { if (v > 8) throw v; return (v | 0) + 1; } finally { s++; seen.length = 0; } } catch (error) {  return s; } }
function f1(v) { let s = 1; depth++; try { s = v.length; return s; } finally { depth--; done++; } }
function f2(v) { let s = 0; try { s = (s + (deep(v, 2))) | 0; } catch (error) { log(frames(error)); s = 0; } return s; }
function f3(v) { let s = 0; for (let k = 0; k < 3; k++) { try { if (k === 1) continue; s += positive(rare(v)); if (s > 50) break; } catch (error) {  s += 1; } finally { if (done === 13) whole.push(13); } } return s; }
function f4(v) { let s = 0; using lock = new Lock(v); s = v.length; return s; }
function f5(v) { let s = 0; try { throw new Own("out", v - open); } catch ({ v: w = 2, message }) { s = w; } return s; }
const f6 = v => { let s = 0; try { s = deep(v, 2); } catch { s = 3; done++; } return s; };
function f7(v) { let s = 0; try { s = (whole[v]) & 255; } catch (error) { if (error instanceof RangeError) s--; else throw error; s = (error instanceof RangeError ? 1 : 2); } finally { { try { strict(v); } catch { done++; } } } return s; }
function f8(v) { let s = 0; for (let k = 0; k < 3; k++) { try { if (k === 1) continue; s += v?.v ?? 2; if (s > 50) break; } catch (error) { done++; s += 1; } finally { { try { strict(v); } catch { done++; } } } } return s; }
function run0(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; s = s + f5(v) + f0(v); } return s; }
for (let k = 0; k < 6; k++) { try { log(0, run0(doubles, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run1(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s += f4(v) + (deep(v, 2)); } catch (error) { mixed.push(3); s += (error instanceof Own ? error.v : 3); } finally { seen.length = 0; } } return s; }
for (let k = 0; k < 6; k++) { try { log(1, run1(views[k % 3], k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run2(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s += f4(v) + (JSON.parse("[" + v + "]")[0]); } catch (error) { log(frames(error)); s += 0; } finally { done++; } } return s; }
for (let k = 0; k < 6; k++) { try { log(2, run2(whole.slice(2), k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run3(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (const v of vs) { const j = seen.length & 15; for (let q = 0; q < 2; q++) { try { s = (s + (v.length) + q) | 0; } catch (error) { if (!(error instanceof TypeError)) throw new Own("again", 1); break; } } if (++turns > 40) break; } return s; }
for (let k = 0; k < 6; k++) { try { log(3, run3(whole.slice(2), k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run4(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s = (s + (index(whole, v))) | 0; } catch (error) { doubles[1] = {}; s--; } } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(4, run4(large, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run5(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (const v of vs) { const j = seen.length & 15; s += f7(v); if (++turns > 40) break; } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(5, run5(views[k % 3], k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run6(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (const v of vs) { const j = seen.length & 15; target[j & 7] = f8(v); s = (s + target[(j + 1) & 7]) | 0; if (++turns > 40) break; } return s; }
for (let k = 0; k < 6; k++) { try { log(6, run6(views[k % 3], k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run7(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (const v of vs) { const j = seen.length & 15; s = s + f4(v) + f3(v); if (++turns > 40) break; } return s; }
for (let k = 0; k < 6; k++) { try { log(7, run7(doubles, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run8(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; target[j & 7] = f6(v); s = (s + target[(j + 1) & 7]) | 0; } return s; }
for (let k = 0; k < 6; k++) { try { log(8, run8(records, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run9(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (const v of vs) { const j = seen.length & 15; for (let q = 0; q < 2; q++) { try { s = (s + (index(whole, v)) + q) | 0; } catch (error) { whole[3] = "s"; break; } } if (++turns > 40) break; } return s; }
for (let k = 0; k < 6; k++) { try { log(9, run9(whole, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run10(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; s += f4(v); } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(10, run10(large, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run11(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; for (let q = 0; q < 2; q++) { try { s = (s + ((v | 0) + 1) + q) | 0; } catch (error) { if (error instanceof RangeError) s--; else throw error; break; } } } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(11, run11(large, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run12(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s = (s + (strict(positive(v)))) | 0; } catch (error) {  s--; } } return s; }
for (let k = 0; k < 6; k++) { try { log(12, run12(signed, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run13(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; target[j & 7] = f5(v); s = (s + target[(j + 1) & 7]) | 0; } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(13, run13(large, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run14(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; if (v > 2) { try { s += f2(v); } catch (error) { Object.freeze(signed); } } else s = (s + f3(v)) | 0; } return s; }
for (let k = 0; k < 6; k++) { try { log(14, run14(views[k % 3], k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run15(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; box.n = box.n + 1; s = (s + f8(v) + box.n) | 0; } return s; }
for (let k = 0; k < 6; k++) { try { log(15, run15(rows[k % 6] ?? [1], k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run16(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s = (s + (positive(v))) | 0; } catch (error) { if (trap instanceof RangeError) done++; s--; } } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(16, run16(rows[k % 6] ?? [1], k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run17(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s = (s + (v > 3 ? positive(v) : rare(v))) | 0; } catch (error) { state++; s--; } } return s; }
for (let k = 0; k < 6; k++) { try { log(17, run17(records, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run18(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; s += f6(v); } return s; }
for (let k = 0; k < 6; k++) { try { log(18, run18(whole.slice(2), k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run19(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; for (let q = 0; q < 2; q++) { try { s = (s + (JSON.parse("[" + v + "]")[0]) + q) | 0; } catch (error) { if (error === null) done += 2; break; } } } return s; }
for (let k = 0; k < 6; k++) { try { log(19, run19(doubles, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run20(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s += f3(v) + (v * 2); } catch (error) { state++; s += 6; } finally { if (done === 13) whole.push(13); } } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(20, run20(whole.slice(2), k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run21(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; if (v > 2) { try { s += f0(v); } catch (error) { seen.push(v); } } else s = (s + f5(v)) | 0; } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(21, run21(views[k % 3], k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run22(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; try { s = (s + (positive(rare(v)))) | 0; } catch (error) { whole[2] = 0.5; s--; } } return s; }
for (let k = 0; k < 6; k++) { try { log(22, run22(whole.slice(2), k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run23(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; for (const v of vs) { const j = seen.length & 15; s += f7(v); if (++turns > 40) break; } return s; }
for (let k = 0; k < 6; k++) { try { log(23, run23(whole, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run24(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (let j = 0; j < vs.length && j < 24; j++) { const v = vs[j]; box.n = box.n + 1; s = (s + f2(v) + box.n) | 0; } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(24, run24(records, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
function run25(vs, k) { let s = 0, turns = 0; const target = [1, 2, 3, 4, 5, 6, 7, 8], box = { n: 0 }; const error = null; try { for (const v of vs) { const j = seen.length & 15; for (let q = 0; q < 2; q++) { try { s = (s + (strict(positive(v))) + q) | 0; } catch (error) { if (error === null) done += 2; break; } } if (++turns > 40) break; } } catch (error) { log("left", frames(error)); s = -5; } return s; }
for (let k = 0; k < 6; k++) { try { log(25, run25(doubles, k), done, open, state, depth); } catch (error) { log("thrown", frames(error)); } }
for (const line of out) console.log(line);
console.log(done, open, state, depth, show(errors.slice(0, 12)), show(seen.slice(0, 8)), show(whole.slice(0, 6)), whole.length, mixed.length);
