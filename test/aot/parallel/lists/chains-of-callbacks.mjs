// Chains of list methods with callbacks over lists of every kind, in loops and outside them.
const INTS = [4, 1, 5, 9, 2, 6, 3]; const DBLS = [1.5, 2.25, -0, 7.5, 4]; const TEXTS = ["b", "", "cc", "4"]; const ROWS = [{ v: 1 }, { v: 2 }, { v: 5 }]; const MIXED = [1, "x", null, undefined, 2.5, true]; const HOLES = [1, , 3, , 5]; const EMPTY = []; const FROZEN = Object.freeze([1, 2, 3, 4]); const BIG = []; for (let k = 0; k < 60; k++) BIG.push((k * 7) % 23);
const box = { items: [8, 3, 5, 1] }; const lines = []; function log(s) { lines.push(s); }
function num(x) { return typeof x === "number" ? x : typeof x === "string" ? x.length : x && typeof x === "object" ? (Array.isArray(x) ? x.length : typeof x.v === "number" ? x.v : 1) : x === true ? 1 : 0; }
function isBig(x) { return num(x) > 3; } function dbl(x) { return num(x) * 2; } function add(p, x) { return num(p) + num(x); }
function show(x, d = 0) { if (d > 3) return "~"; if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x); if (typeof x === "string") return JSON.stringify(x); if (Array.isArray(x)) { let t = "["; for (let k = 0; k < Math.min(x.length, 14); k++) t += (k in x ? show(x[k], d + 1) : "_") + ","; return t + "]" + x.length; } if (x && typeof x === "object") return "{" + Object.keys(x).map(k => k + ":" + show(x[k], d + 1)).join() + "}"; return String(x); }
let total = 0; function finish(name, a) { console.log(name, a.slice(0, 260), lines.length); lines.length = 0; total++; }
function run(name, f) { let a; try { a = show(f()); } catch (e) { a = "!" + e.constructor.name + " " + e.message; } finish(name, a); }
async function runLater(name, f) { let a; try { a = show(await f()); } catch (e) { a = "!" + e.constructor.name + " " + e.message; } finish(name, a); }
class K_f0 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; try { return INTS.map(x => { c++; return c; }).join('-'); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } } }
run("f0", () => new K_f0().m([5, 1, 7, 2, 4], 2));
async function f1(a, lim, this_) { let c = 0; await null; const l = EMPTY.reverse().indexOf(4); return l; }
await runLater("f1", () => f1([5, 1, 7, 2, 4], 2, box));
async function f2(a, lim, this_) { let c = 0; await null; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(this_.items.map(x => x).find(x => x !== undefined)); } return r; }
await runLater("f2", () => f2([5, 1, 7, 2, 4], 2, box));
async function f3(a, lim, this_) { let c = 0; await null; try { return INTS.filter(x => num(x) < 100).filter(x => { if (num(x) === 5) throw new Error('p5'); return true; }).some(x => !!x); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } }
await runLater("f3", () => f3([5, 1, 7, 2, 4], 2, box));
function* f4(a, lim, this_) { let c = 0; yield 1; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(EMPTY.map(Number)); } return r; }
run("f4", () => { const it = f4([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
const f5 = (a, lim, this_) => { let c = 0; return MIXED.flatMap(x => [x, num(x)]).filter((x, k) => k % 2 === 0).reduce((p, x) => Math.max(p, num(x)), -1); };
run("f5", () => f5([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f5l" + q, () => f5([q, 2, 4, 5], q, box));
const f6 = (a, lim, this_) => { let c = 0; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(a.slice(1, 4).reduce(add, lim)); } return r; };
run("f6", () => f6([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f6l" + q, () => f6([q, 2, 4, 5], q, box));
class K_f7 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const l = TEXTS.sort((p, q) => num(p) - num(q)).reverse().indexOf(4); return l; } }
run("f7", () => new K_f7().m([5, 1, 7, 2, 4], 2));
class K_f8 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const p = FROZEN.slice(1, 4).map(Number).join('-'); const q = a.sort((p, q) => num(p) - num(q)).map(x => String(x)).reduce((p, x) => p + String(x), ''); return [p, q]; } }
run("f8", () => new K_f8().m([5, 1, 7, 2, 4], 2));
async function f9(a, lim, this_) { let c = 0; await null; if (lim > 0) return HOLES.filter(x => { if (c++ === 2 && Array.isArray(a) && !Object.isFrozen(a)) a.push(9); return true; }).slice(1, 4).forEach(x => { c += num(x); }); return [...INTS].map(x => { log('m'); return x; }).flatMap(x => [x, num(x)]).findIndex(x => { log('p'); return num(x) > 1; }); }
await runLater("f9", () => f9([5, 1, 7, 2, 4], 2, box));
function f10(a, lim, this_) { let c = 0; let t = 0; for (const x of INTS) { const y = ROWS.filter(x => num(x) < 100).sort((p, q) => num(p) - num(q))[1]; t += num(y); } return t; }
run("f10", () => f10([5, 1, 7, 2, 4], 2, box)); run("f10b", () => f10([1.5, 4, 9.25, 3], 0, box)); run("f10c", () => f10(["q", 3, null, 8], 1, box));
function f11(a, lim, this_) { let c = 0; if (lim > 0) return a.filter(x => num(x) > 2).slice(1, 4); return MIXED.concat([1]).filter(isBig).length; }
run("f11", () => f11([5, 1, 7, 2, 4], 2, box)); run("f11b", () => f11([1.5, 4, 9.25, 3], 0, box)); run("f11c", () => f11(["q", 3, null, 8], 1, box));
function f12(a, lim, this_) { let c = 0; try { return EMPTY.filter((x, k) => k % 2 === 0).flatMap(x => [x, num(x)]).findIndex((x, k, l) => l.length > 3); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } }
run("f12", () => f12([5, 1, 7, 2, 4], 2, box)); run("f12b", () => f12([1.5, 4, 9.25, 3], 0, box)); run("f12c", () => f12(["q", 3, null, 8], 1, box));
const f13 = (a, lim, this_) => { let c = 0; const f = () => HOLES.concat([1]).length; return [f(), f()]; };
run("f13", () => f13([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f13l" + q, () => f13([q, 2, 4, 5], q, box));
const f14 = (a, lim, this_) => { let c = 0; try { return INTS.map(x => { c++; return c; }).flatMap(x => [x, num(x)]); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } };
run("f14", () => f14([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f14l" + q, () => f14([q, 2, 4, 5], q, box));
function f15(a, lim, this_) { let c = 0; const f = () => FROZEN.flatMap(x => [x, num(x)]).find(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }); return [f(), f()]; }
run("f15", () => f15([5, 1, 7, 2, 4], 2, box)); run("f15b", () => f15([1.5, 4, 9.25, 3], 0, box)); run("f15c", () => f15(["q", 3, null, 8], 1, box));
function f16(a, lim, this_) { let c = 0; const l = EMPTY.filter(x => num(x) > 2).indexOf(4); return l; }
run("f16", () => f16([5, 1, 7, 2, 4], 2, box)); run("f16b", () => f16([1.5, 4, 9.25, 3], 0, box)); run("f16c", () => f16(["q", 3, null, 8], 1, box));
function* f17(a, lim, this_) { let c = 0; yield 1; if (lim > 0) return EMPTY.reverse().filter(x => num(x) > 2).filter(() => false)[1]; return this_.items.map(x => num(x) > 2 ? x : undefined)[1]; }
run("f17", () => { const it = f17([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
class K_f18 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; try { return [...INTS].map(x => num(x) * 2).sort((p, q) => num(p) - num(q)).at(-1); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } } }
run("f18", () => new K_f18().m([5, 1, 7, 2, 4], 2));
function f19(a, lim, this_) { let c = 0; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(a.filter(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }).at(-1)); } return r; }
run("f19", () => f19([5, 1, 7, 2, 4], 2, box)); run("f19b", () => f19([1.5, 4, 9.25, 3], 0, box)); run("f19c", () => f19(["q", 3, null, 8], 1, box));
async function f20(a, lim, this_) { let c = 0; await null; if (lim > 0) return INTS.sort((p, q) => num(p) - num(q)).filter(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }).flatMap(x => [x, num(x)]).length; return INTS.map(Number).at(-1); }
await runLater("f20", () => f20([5, 1, 7, 2, 4], 2, box));
class K_f21 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const p = Array.from(a).concat([1]).filter(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }).forEach(x => { c += num(x); }); const q = FROZEN.map(x => num(x) > 2 ? x : undefined).concat([1]).forEach(x => { c += num(x); }); return [p, q]; } }
run("f21", () => new K_f21().m([5, 1, 7, 2, 4], 2));
class K_f22 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const l = DBLS.filter(x => num(x) > 2)[1]; return l; } }
run("f22", () => new K_f22().m([5, 1, 7, 2, 4], 2));
async function f23(a, lim, this_) { let c = 0; await null; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(TEXTS.slice()); } return r; }
await runLater("f23", () => f23([5, 1, 7, 2, 4], 2, box));
function* f24(a, lim, this_) { let c = 0; yield 1; const p = a.map(x => { log('m'); return x; }).map(x => num(x) + 0.5).slice().forEach(x => { c += num(x); }); const q = INTS.concat([1]).indexOf(4); return [p, q]; }
run("f24", () => { const it = f24([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
class K_f25 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const p = FROZEN.sort((p, q) => num(p) - num(q)).slice(1, 4).flatMap(x => [x, num(x)]).forEach(x => { c += num(x); }); const q = a.reverse().slice(1, 4).find(x => { c++; return num(x) > lim; }); return [p, q]; } }
run("f25", () => new K_f25().m([5, 1, 7, 2, 4], 2));
function* f26(a, lim, this_) { let c = 0; yield 1; const f = () => a.reverse().indexOf(4); return [f(), f()]; }
run("f26", () => { const it = f26([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
async function f27(a, lim, this_) { let c = 0; await null; const f = () => ROWS.slice(1, 4).filter(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }).length; return [f(), f()]; }
await runLater("f27", () => f27([5, 1, 7, 2, 4], 2, box));
async function f28(a, lim, this_) { let c = 0; await null; let t = 0; for (const x of INTS) { const y = HOLES.map(dbl).forEach(x => { c += num(x); }); t += num(y); } return t; }
await runLater("f28", () => f28([5, 1, 7, 2, 4], 2, box));
function* f29(a, lim, this_) { let c = 0; yield 1; let t = 0; for (const x of INTS) { const y = FROZEN.sort((p, q) => num(p) - num(q)).every((x, k, l) => l.length > 3); t += num(y); } return t; }
run("f29", () => { const it = f29([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function f30(a, lim, this_) { let c = 0; return FROZEN.sort((p, q) => num(p) - num(q)).forEach(x => { c += num(x); }); }
run("f30", () => f30([5, 1, 7, 2, 4], 2, box)); run("f30b", () => f30([1.5, 4, 9.25, 3], 0, box)); run("f30c", () => f30(["q", 3, null, 8], 1, box));
class K_f31 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const l = [...INTS].filter(x => num(x) > 2).slice()[1]; return l; } }
run("f31", () => new K_f31().m([5, 1, 7, 2, 4], 2));
async function f32(a, lim, this_) { let c = 0; await null; return a.map(x => num(x) * 2).map(x => ({ v: x })).indexOf(4); }
await runLater("f32", () => f32([5, 1, 7, 2, 4], 2, box));
function f33(a, lim, this_) { let c = 0; return a.slice(1, 4).filter((x, k) => k % 2 === 0).slice().reduce(add, lim); }
run("f33", () => f33([5, 1, 7, 2, 4], 2, box)); run("f33b", () => f33([1.5, 4, 9.25, 3], 0, box)); run("f33c", () => f33(["q", 3, null, 8], 1, box));
function f34(a, lim, this_) { let c = 0; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(Array.from(a).slice().slice(1, 4)); } return r; }
run("f34", () => f34([5, 1, 7, 2, 4], 2, box)); run("f34b", () => f34([1.5, 4, 9.25, 3], 0, box)); run("f34c", () => f34(["q", 3, null, 8], 1, box));
const f35 = (a, lim, this_) => { let c = 0; if (lim > 0) return this_.items.concat([1]).indexOf(4); return ROWS.concat([1]).flatMap(x => [x, num(x)]).filter(x => (num(x) & 1) === 0).every(x => num(x) > 2); };
run("f35", () => f35([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f35l" + q, () => f35([q, 2, 4, 5], q, box));
function f36(a, lim, this_) { let c = 0; return a.concat([1]).map(x => String(x)).every(x => { c++; return num(x) > lim; }); }
run("f36", () => f36([5, 1, 7, 2, 4], 2, box)); run("f36b", () => f36([1.5, 4, 9.25, 3], 0, box)); run("f36c", () => f36(["q", 3, null, 8], 1, box));
function f37(a, lim, this_) { let c = 0; if (lim > 0) return ROWS.reverse().sort((p, q) => num(p) - num(q)).length; return HOLES.map(x => { c++; return c; }).indexOf(4); }
run("f37", () => f37([5, 1, 7, 2, 4], 2, box)); run("f37b", () => f37([1.5, 4, 9.25, 3], 0, box)); run("f37c", () => f37(["q", 3, null, 8], 1, box));
function* f38(a, lim, this_) { let c = 0; yield 1; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(FROZEN.slice(1, 4).map(x => num(x) > 2 ? x : undefined).at(-1)); } return r; }
run("f38", () => { const it = f38([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
const f39 = (a, lim, this_) => { let c = 0; return DBLS.slice(1, 4).length; };
run("f39", () => f39([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f39l" + q, () => f39([q, 2, 4, 5], q, box));
const f40 = (a, lim, this_) => { let c = 0; const l = FROZEN.slice().slice().reduce((p, x) => p + num(x), 0.5); return l; };
run("f40", () => f40([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f40l" + q, () => f40([q, 2, 4, 5], q, box));
function* f41(a, lim, this_) { let c = 0; yield 1; return INTS.filter(x => { c++; return num(x) > lim; }).join('-'); }
run("f41", () => { const it = f41([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function* f42(a, lim, this_) { let c = 0; yield 1; const p = [...INTS].reverse().map(x => -num(x))[1]; const q = a.slice().concat([1]).map(x => { c++; return c; }).every((x, k, l) => l.length > 3); return [p, q]; }
run("f42", () => { const it = f42([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function f43(a, lim, this_) { let c = 0; let t = 0; for (const x of INTS) { const y = DBLS.concat([1]).map(x => { c++; return c; }).slice().forEach(x => { c += num(x); }); t += num(y); } return t; }
run("f43", () => f43([5, 1, 7, 2, 4], 2, box)); run("f43b", () => f43([1.5, 4, 9.25, 3], 0, box)); run("f43c", () => f43(["q", 3, null, 8], 1, box));
function f44(a, lim, this_) { let c = 0; const l = DBLS.flatMap(x => [x, num(x)]); return l; }
run("f44", () => f44([5, 1, 7, 2, 4], 2, box)); run("f44b", () => f44([1.5, 4, 9.25, 3], 0, box)); run("f44c", () => f44(["q", 3, null, 8], 1, box));
function f45(a, lim, this_) { let c = 0; const l = EMPTY.map(Number).filter(x => x !== undefined).flatMap(x => [x, num(x)]).indexOf(4); return l; }
run("f45", () => f45([5, 1, 7, 2, 4], 2, box)); run("f45b", () => f45([1.5, 4, 9.25, 3], 0, box)); run("f45c", () => f45(["q", 3, null, 8], 1, box));
function f46(a, lim, this_) { let c = 0; const l = MIXED.filter(() => false).map(x => num(x) % 3 === 0 ? 'three' : num(x)).flatMap(x => [x, num(x)]).join('-'); return l; }
run("f46", () => f46([5, 1, 7, 2, 4], 2, box)); run("f46b", () => f46([1.5, 4, 9.25, 3], 0, box)); run("f46c", () => f46(["q", 3, null, 8], 1, box));
function* f47(a, lim, this_) { let c = 0; yield 1; return INTS.slice(1, 4).slice(1, 4).concat([1])[1]; }
run("f47", () => { const it = f47([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
class K_f48 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; if (lim > 0) return BIG.map(x => num(x) % 3 === 0 ? 'three' : num(x)).concat([1]); return FROZEN.map(x => x).flatMap(x => [x, num(x)]).slice(1, 4); } }
run("f48", () => new K_f48().m([5, 1, 7, 2, 4], 2));
class K_f49 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const f = () => BIG.sort((p, q) => num(p) - num(q)).sort((p, q) => num(p) - num(q)).some(x => { c++; return num(x) > lim; }); return [f(), f()]; } }
run("f49", () => new K_f49().m([5, 1, 7, 2, 4], 2));
async function f50(a, lim, this_) { let c = 0; await null; return a.concat([1]); }
await runLater("f50", () => f50([5, 1, 7, 2, 4], 2, box));
const f51 = (a, lim, this_) => { let c = 0; let t = 0; for (const x of INTS) { const y = BIG.concat([1]).at(-1); t += num(y); } return t; };
run("f51", () => f51([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f51l" + q, () => f51([q, 2, 4, 5], q, box));
const f52 = (a, lim, this_) => { let c = 0; const f = () => TEXTS.filter(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }).map(dbl).forEach(x => { c += num(x); }); return [f(), f()]; };
run("f52", () => f52([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f52l" + q, () => f52([q, 2, 4, 5], q, box));
class K_f53 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const p = MIXED.concat([1]).slice(1, 4).find(x => { log('p'); return num(x) > 1; }); const q = ROWS.map(x => -num(x)).indexOf(4); return [p, q]; } }
run("f53", () => new K_f53().m([5, 1, 7, 2, 4], 2));
function* f54(a, lim, this_) { let c = 0; yield 1; const p = INTS.map(x => x).reverse().flatMap(x => [x, num(x)]).forEach(x => { c += num(x); }); const q = a.slice().findIndex(x => { if (num(x) === 5) throw new Error('p5'); return true; }); return [p, q]; }
run("f54", () => { const it = f54([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
async function f55(a, lim, this_) { let c = 0; await null; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(TEXTS.map(x => num(x) % 3 === 0 ? 'three' : num(x)).flatMap(x => [x, num(x)]).map(x => { c++; return c; }).join('-')); } return r; }
await runLater("f55", () => f55([5, 1, 7, 2, 4], 2, box));
class K_f56 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; if (lim > 0) return INTS.flatMap(x => [x, num(x)]).reverse().sort((p, q) => num(p) - num(q)).forEach(x => { c += num(x); }); return Array.from(a).filter(Boolean); } }
run("f56", () => new K_f56().m([5, 1, 7, 2, 4], 2));
function* f57(a, lim, this_) { let c = 0; yield 1; const f = () => FROZEN.concat([1]).flatMap(x => [x, num(x)]).reduce((p, x) => p + String(x), ''); return [f(), f()]; }
run("f57", () => { const it = f57([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function f58(a, lim, this_) { let c = 0; const f = () => INTS.map(x => num(x) + lim).indexOf(4); return [f(), f()]; }
run("f58", () => f58([5, 1, 7, 2, 4], 2, box)); run("f58b", () => f58([1.5, 4, 9.25, 3], 0, box)); run("f58c", () => f58(["q", 3, null, 8], 1, box));
class K_f59 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(Array.from(a).filter(x => !!x).flatMap(x => [x, num(x)]).forEach(x => { c += num(x); })); } return r; } }
run("f59", () => new K_f59().m([5, 1, 7, 2, 4], 2));
async function f60(a, lim, this_) { let c = 0; await null; let t = 0; for (const x of INTS) { const y = [...INTS].concat([1]).join('-'); t += num(y); } return t; }
await runLater("f60", () => f60([5, 1, 7, 2, 4], 2, box));
async function f61(a, lim, this_) { let c = 0; await null; const f = () => a.filter((x, k) => k % 2 === 0).indexOf(4); return [f(), f()]; }
await runLater("f61", () => f61([5, 1, 7, 2, 4], 2, box));
const f62 = (a, lim, this_) => { let c = 0; if (lim > 0) return INTS.slice(1).map(x => { log('m'); return x; }).map(x => num(x) + lim).some(x => num(x) < 100); return HOLES.reverse().find(isBig); };
run("f62", () => f62([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f62l" + q, () => f62([q, 2, 4, 5], q, box));
function f63(a, lim, this_) { let c = 0; try { return DBLS.reverse().slice().forEach(x => { c += num(x); }); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } }
run("f63", () => f63([5, 1, 7, 2, 4], 2, box)); run("f63b", () => f63([1.5, 4, 9.25, 3], 0, box)); run("f63c", () => f63(["q", 3, null, 8], 1, box));
class K_f64 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(EMPTY.slice().slice(1, 4).every(x => num(x) < 100)); } return r; } }
run("f64", () => new K_f64().m([5, 1, 7, 2, 4], 2));
class K_f65 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; let r = []; for (let k = 0; k < 3; k++) { lim = k; r.push(a.filter(x => { c++; return num(x) > lim; }).map(Number).slice(1, 4).indexOf(4)); } return r; } }
run("f65", () => new K_f65().m([5, 1, 7, 2, 4], 2));
const f66 = (a, lim, this_) => { let c = 0; return a.flatMap(x => [x, num(x)]).map(Number).filter(x => num(x) > 2).findIndex(x => num(x) > 2); };
run("f66", () => f66([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f66l" + q, () => f66([q, 2, 4, 5], q, box));
async function f67(a, lim, this_) { let c = 0; await null; const l = a.reverse(); return l; }
await runLater("f67", () => f67([5, 1, 7, 2, 4], 2, box));
async function f68(a, lim, this_) { let c = 0; await null; try { return a.filter(x => { if (c++ === 2 && Array.isArray(a) && !Object.isFrozen(a)) a.push(9); return true; }); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } }
await runLater("f68", () => f68([5, 1, 7, 2, 4], 2, box));
function f69(a, lim, this_) { let c = 0; try { return [...INTS].map(x => String(x)).length; } catch (e) { return 'caught ' + e.message; } finally { log('f'); } }
run("f69", () => f69([5, 1, 7, 2, 4], 2, box)); run("f69b", () => f69([1.5, 4, 9.25, 3], 0, box)); run("f69c", () => f69(["q", 3, null, 8], 1, box));
function* f70(a, lim, this_) { let c = 0; yield 1; const f = () => MIXED.filter(x => { if (num(x) === 5) throw new Error('p5'); return true; }).length; return [f(), f()]; }
run("f70", () => { const it = f70([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
const f71 = (a, lim, this_) => { let c = 0; try { return Array.from(a).map(x => ({ v: x })).slice(1, 4).some(x => x !== undefined); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } };
run("f71", () => f71([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f71l" + q, () => f71([q, 2, 4, 5], q, box));
const f72 = (a, lim, this_) => { let c = 0; const f = () => DBLS.flatMap(x => [x, num(x)]).concat([1])[1]; return [f(), f()]; };
run("f72", () => f72([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f72l" + q, () => f72([q, 2, 4, 5], q, box));
async function f73(a, lim, this_) { let c = 0; await null; try { return [...INTS].slice(1, 4).reverse().concat([1]).at(-1); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } }
await runLater("f73", () => f73([5, 1, 7, 2, 4], 2, box));
const f74 = (a, lim, this_) => { let c = 0; if (lim > 0) return TEXTS.filter((x, k) => k % 2 === 0).reduce((p, x) => Math.max(p, num(x)), -1); return INTS.slice().every(x => x !== undefined); };
run("f74", () => f74([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f74l" + q, () => f74([q, 2, 4, 5], q, box));
async function f75(a, lim, this_) { let c = 0; await null; return FROZEN.map((x, k) => k).concat([1]).filter(x => (num(x) & 1) === 0); }
await runLater("f75", () => f75([5, 1, 7, 2, 4], 2, box));
function f76(a, lim, this_) { let c = 0; const f = () => a.sort((p, q) => num(p) - num(q)).map(x => -num(x)).forEach(x => { c += num(x); }); return [f(), f()]; }
run("f76", () => f76([5, 1, 7, 2, 4], 2, box)); run("f76b", () => f76([1.5, 4, 9.25, 3], 0, box)); run("f76c", () => f76(["q", 3, null, 8], 1, box));
async function f77(a, lim, this_) { let c = 0; await null; const l = Array.from(a).flatMap(x => [x, num(x)]).concat([1]).length; return l; }
await runLater("f77", () => f77([5, 1, 7, 2, 4], 2, box));
function f78(a, lim, this_) { let c = 0; if (lim > 0) return a.reverse().filter(x => { if (c++ === 2 && Array.isArray(a) && !Object.isFrozen(a)) a.push(9); return true; }).reverse().reduce((p, x, k) => p * 3 + k, 1); return TEXTS.reverse().slice(1, 4).flatMap(x => [x, num(x)]).length; }
run("f78", () => f78([5, 1, 7, 2, 4], 2, box)); run("f78b", () => f78([1.5, 4, 9.25, 3], 0, box)); run("f78c", () => f78(["q", 3, null, 8], 1, box));
const f79 = (a, lim, this_) => { let c = 0; return INTS.map(x => num(x) * 2)[1]; };
run("f79", () => f79([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f79l" + q, () => f79([q, 2, 4, 5], q, box));
const f80 = (a, lim, this_) => { let c = 0; const f = () => FROZEN.filter(Boolean).map(x => num(x) + lim).slice().length; return [f(), f()]; };
run("f80", () => f80([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f80l" + q, () => f80([q, 2, 4, 5], q, box));
async function f81(a, lim, this_) { let c = 0; await null; const l = HOLES.concat([1]).sort((p, q) => num(p) - num(q)).reduce(add, lim); return l; }
await runLater("f81", () => f81([5, 1, 7, 2, 4], 2, box));
function* f82(a, lim, this_) { let c = 0; yield 1; const p = TEXTS.concat([1]).sort((p, q) => num(p) - num(q)).indexOf(4); const q = a.filter(x => { log('p'); return num(x) > 1; }).indexOf(4); return [p, q]; }
run("f82", () => { const it = f82([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function* f83(a, lim, this_) { let c = 0; yield 1; const p = HOLES.sort((p, q) => num(p) - num(q)).reduce((p, x) => p + num(x), 0.5); const q = BIG.reverse().map(x => { c++; return c; }).concat([1]).join('-'); return [p, q]; }
run("f83", () => { const it = f83([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function f84(a, lim, this_) { let c = 0; const f = () => EMPTY.filter(x => num(x) > 2).find(x => num(x) > 2); return [f(), f()]; }
run("f84", () => f84([5, 1, 7, 2, 4], 2, box)); run("f84b", () => f84([1.5, 4, 9.25, 3], 0, box)); run("f84c", () => f84(["q", 3, null, 8], 1, box));
const f85 = (a, lim, this_) => { let c = 0; const p = MIXED.slice().findIndex(x => { if (num(x) === 5) throw new Error('p5'); return true; }); const q = TEXTS.map(x => ({ v: x })).flatMap(x => [x, num(x)]).indexOf(4); return [p, q]; };
run("f85", () => f85([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f85l" + q, () => f85([q, 2, 4, 5], q, box));
class K_f86 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; let t = 0; for (const x of INTS) { const y = a.filter(x => (num(x) & 1) === 0).reverse().filter(() => false).reduce((p, x) => { c++; return num(p) + num(x); }); t += num(y); } return t; } }
run("f86", () => new K_f86().m([5, 1, 7, 2, 4], 2));
function f87(a, lim, this_) { let c = 0; return FROZEN.map(x => num(x) + 0.5).at(-1); }
run("f87", () => f87([5, 1, 7, 2, 4], 2, box)); run("f87b", () => f87([1.5, 4, 9.25, 3], 0, box)); run("f87c", () => f87(["q", 3, null, 8], 1, box));
const f88 = (a, lim, this_) => { let c = 0; const f = () => MIXED.map(x => { if (num(x) === 7) throw new Error('m7'); return num(x) | 0; }).filter(x => { log('p'); return num(x) > 1; }).slice().findIndex(x => { log('p'); return num(x) > 1; }); return [f(), f()]; };
run("f88", () => f88([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f88l" + q, () => f88([q, 2, 4, 5], q, box));
const f89 = (a, lim, this_) => { let c = 0; return INTS.slice(1).sort((p, q) => num(p) - num(q)).slice().reverse().join('-'); };
run("f89", () => f89([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f89l" + q, () => f89([q, 2, 4, 5], q, box));
const f90 = (a, lim, this_) => { let c = 0; const p = FROZEN.map(x => num(x) % 3 === 0 ? 'three' : num(x)).slice().concat([1]).some(() => false); const q = BIG.reverse().sort((p, q) => num(p) - num(q))[1]; return [p, q]; };
run("f90", () => f90([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f90l" + q, () => f90([q, 2, 4, 5], q, box));
const f91 = (a, lim, this_) => { let c = 0; const f = () => INTS.slice(1).map(x => { c++; return c; }).find(x => { log('p'); return num(x) > 1; }); return [f(), f()]; };
run("f91", () => f91([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f91l" + q, () => f91([q, 2, 4, 5], q, box));
async function f92(a, lim, this_) { let c = 0; await null; if (lim > 0) return this_.items.slice(1, 4).concat([1]).findIndex(x => !!x); return Array.from(a).flatMap(x => [x, num(x)]).reverse().join('-'); }
await runLater("f92", () => f92([5, 1, 7, 2, 4], 2, box));
function* f93(a, lim, this_) { let c = 0; yield 1; return Array.from(a).concat([1]).filter(x => !!x).reverse().join('-'); }
run("f93", () => { const it = f93([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function* f94(a, lim, this_) { let c = 0; yield 1; const l = Array.from(a).filter(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }).filter(x => { if (num(x) === 5) throw new Error('p5'); return true; }).sort((p, q) => num(p) - num(q)).forEach(x => { c += num(x); }); return l; }
run("f94", () => { const it = f94([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
const f95 = (a, lim, this_) => { let c = 0; if (lim > 0) return EMPTY.flatMap(x => [x, num(x)]).map(x => String(x)).reduce((p, x) => Math.max(p, num(x)), -1); return [...INTS].concat([1]).reverse().forEach(x => { c += num(x); }); };
run("f95", () => f95([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f95l" + q, () => f95([q, 2, 4, 5], q, box));
class K_f96 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; if (lim > 0) return INTS.map(x => num(x) + 0.5).some(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }); return ROWS.concat([1]).filter(x => { log('p'); return num(x) > 1; }).at(-1); } }
run("f96", () => new K_f96().m([5, 1, 7, 2, 4], 2));
const f97 = (a, lim, this_) => { let c = 0; const p = FROZEN.filter(isBig).findIndex(x => { if (num(x) === 5) throw new Error('p5'); return true; }); const q = INTS.slice(1).map(x => { c++; return c; }).reverse().slice(1, 4).forEach(x => { c += num(x); }); return [p, q]; };
run("f97", () => f97([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f97l" + q, () => f97([q, 2, 4, 5], q, box));
async function f98(a, lim, this_) { let c = 0; await null; let t = 0; for (const x of INTS) { const y = INTS.map(dbl).slice().indexOf(4); t += num(y); } return t; }
await runLater("f98", () => f98([5, 1, 7, 2, 4], 2, box));
const f99 = (a, lim, this_) => { let c = 0; const l = this_.items.filter(x => !!x).indexOf(4); return l; };
run("f99", () => f99([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f99l" + q, () => f99([q, 2, 4, 5], q, box));
class K_f100 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; const p = a.slice().map(x => num(x) % 3 === 0 ? 'three' : num(x)).concat([1]).at(-1); const q = INTS.slice(1).reverse().filter(isBig).filter(x => num(x) > 2).find(x => x !== undefined); return [p, q]; } }
run("f100", () => new K_f100().m([5, 1, 7, 2, 4], 2));
const f101 = (a, lim, this_) => { let c = 0; const l = MIXED.slice(1, 4).flatMap(x => [x, num(x)]).some(x => (num(x) & 1) === 0); return l; };
run("f101", () => f101([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f101l" + q, () => f101([q, 2, 4, 5], q, box));
function* f102(a, lim, this_) { let c = 0; yield 1; let t = 0; for (const x of INTS) { const y = Array.from(a).filter((x, k, l) => l.length > 3).reduce((p, x) => p + String(x), ''); t += num(y); } return t; }
run("f102", () => { const it = f102([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function* f103(a, lim, this_) { let c = 0; yield 1; const f = () => a.concat([1]).forEach(x => { c += num(x); }); return [f(), f()]; }
run("f103", () => { const it = f103([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
function* f104(a, lim, this_) { let c = 0; yield 1; const p = a.map(x => num(x) % 3 === 0 ? 'three' : num(x)).findIndex(x => x !== undefined); const q = DBLS.slice(1, 4); return [p, q]; }
run("f104", () => { const it = f104([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
class K_f105 { items = [3, 6, 5]; m(a, lim) { const this_ = this; let c = 0; try { return a.map(x => [x]).map(x => num(x) > 2 ? x : undefined).reduce((p, x) => { c++; return num(p) + num(x); }); } catch (e) { return 'caught ' + e.message; } finally { log('f'); } } }
run("f105", () => new K_f105().m([5, 1, 7, 2, 4], 2));
const f106 = (a, lim, this_) => { let c = 0; const f = () => HOLES.map(x => ({ v: x })).indexOf(4); return [f(), f()]; };
run("f106", () => f106([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f106l" + q, () => f106([q, 2, 4, 5], q, box));
function f107(a, lim, this_) { let c = 0; return INTS.filter(x => { log('p'); return num(x) > 1; }).filter((x, k, l) => l.length > 3).flatMap(x => [x, num(x)]).reduce((p, x) => p + num(x), 0.5); }
run("f107", () => f107([5, 1, 7, 2, 4], 2, box)); run("f107b", () => f107([1.5, 4, 9.25, 3], 0, box)); run("f107c", () => f107(["q", 3, null, 8], 1, box));
const f108 = (a, lim, this_) => { let c = 0; const f = () => Array.from(a).flatMap(x => [x, num(x)]).map(x => ({ v: x })).some(x => num(x) > 2); return [f(), f()]; };
run("f108", () => f108([5, 1, 7, 2, 4], 2, box)); for (let q = 0; q < 3; q++) run("f108l" + q, () => f108([q, 2, 4, 5], q, box));
function* f109(a, lim, this_) { let c = 0; yield 1; let t = 0; for (const x of INTS) { const y = a.reverse().every(x => { if (c++ === 1 && !Object.isFrozen(a)) a.length = 2; return true; }); t += num(y); } return t; }
run("f109", () => { const it = f109([5, 1, 7, 2, 4], 2, box); let r; do r = it.next(); while (!r.done); return r.value; });
console.log(total);
export {};
