// Loops delegate to calls of generator functions that are found at run time. Some never yield, some have changed prototypes.
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = ((k) => function* ([a] = [7]) { say("eval", nested(a)); for (const x of [1, 2]) state.n += x; return { done: false, value: a }; })(1);
function* m1(a, b) { return "s" + a; } lib.m1 = m1;
lib.m2 = (class { static *m2(a, b, c, d, e, f, g) { if (a > 4) { state.n++; } for (const x of [1, 2]) state.n += x; const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return Symbol.iterator; } }).m2;
lib.m0.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; };
const rows = []; rows.push({ process: lib.m1, v: 0, skip: true }); rows.push({ process: lib.m1, v: 1, skip: true }); rows.push({ process: lib.m2, v: 2, skip: false }); rows.push({ process: lib.m1, v: 3, skip: false }); rows.push({ process: lib.m1, v: 4, skip: undefined }); rows.push({ process: lib.m0, v: 5, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { let i = 0; while (i < 12) { const row = table.get(i++); if (row == null) continue; const v = yield* row.process.call(null, i, 2, 3, 4, 5, 6, 7, 8); say(typeof v); } return "end"; } };
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = (class { static *m0(a, b = say("default")) { if (a > 4) { state.n++; } for (const x of [1, 2]) state.n += x; const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return lib.leaf(a, state); } }).m0;
lib.m1 = { *m1(a = this === undefined ? 1 : 2) { say("b", typeof this, a); this && (this.seen = (this.seen | 0) + 1); state.last = this;  } }.m1;
lib.m2 = ((k) => function* (a, b, c, d, e, f, g) { if (a === 5 && state.n > 40) throw new TypeError("five"); say("eval", nested(a)); return [a, state.n]; })(1);
lib.m3 = ((k) => function* (a, ...rest) { if (a & 1) yield a; state.line = (state.line | 0) + 1; state.n += 1; say("deeper", yield* lib.leaf(a, state)); return { done: false, value: a }; })(1);
lib.m4 = { *m4([a] = [7]) { try { yield a; } finally { say("f", a); } return 2 ** 31; } }.m4;
lib.m5 = ((k) => function* (a, b = say("default")) { say("eval", nested(a)); say("sub", [...inner(a)].join()); say("sub", [...inner(a)].join()); return [a, state.n]; })(1);
lib.m6 = { *m6(a, b, c, d, e, f, g) { for (const x of [1, 2]) state.n += x; return a; } }.m6;
lib.m3.isEnd = true;
lib.m5.isEnd = true;
lib.m5.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; };
const rows = []; rows.push({ process: lib.m1, v: 0, skip: true }); rows.push({ process: lib.m4, v: 1, skip: false }); rows.push({ process: lib.m0, v: 2, skip: true }); rows.push({ process: lib.m2, v: 3, skip: undefined }); rows.push({ process: lib.m5, v: 4, skip: true }); rows.push({ process: lib.m6, v: 5, skip: false }); rows.push({ process: lib.m0, v: 6, skip: true });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { for (let i = 0; i < 17; i++) { const row = table.get(i); if (row === undefined || row.v > 4) { say("skip", i); continue; } yield* row.process?.(state); if (i == 9) yield "nine"; } return "end"; } };
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = function* ({ length: a }) { this && (this.seen = (this.seen | 0) + 1); say("sent", yield a); return Symbol.iterator; };
lib.m1 = ((k) => function* (a, ...rest) { state.line = (state.line | 0) + 1; return { done: false, value: a }; })(1);
lib.m2 = function* (a, b = say("default")) { state.line = (state.line | 0) + 1; return { done: false, value: a }; };
lib.m3 = { *m3(a) { say("b", typeof this, a); return null; } }.m3;
lib.m4 = { *m4([a] = [7]) { this && (this.seen = (this.seen | 0) + 1); return null; } }.m4;
lib.m0.isEnd = true;
lib.m1.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; };
Object.getPrototypeOf(Object.getPrototypeOf(inner.prototype)).extra = 1;
const rows = []; rows.push({ process: lib.m2, v: 0, skip: false }); rows.push({ process: lib.m0, v: 1, skip: false }); rows.push({ process: lib.m1, v: 2, skip: true }); rows.push({ process: lib.m2, v: 3, skip: true }); rows.push({ process: lib.m0, v: 4, skip: true }); rows.push({ process: lib.m2, v: 5, skip: true });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { let i = 0; while (i < 12) { const row = table.get(i++); if (!row || row.process == null || row.skip) continue; state.last = row; state.last = yield* row.process?.(undefined); } return "end"; } };
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
function* m0(a, b) { state.line = (state.line | 0) + 1; for (const x of [1, 2]) state.n += x; for (let i = 0; i < 2; i++) state.n += i; if (a & 1) yield a; return lib.leaf(a, state); } lib.m0 = m0;
lib.m1 = function* (a, b, c, d, e, f, g) { if (a & 1) yield a; return 2 ** 31; };
lib.m2 = { *m2(a, b, c, d, e, f, g) { const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return 2 ** 31; } }.m2;
lib.m3 = (class { static *m3(a, b) { try { yield a; } finally { say("f", a); } fs.push(() => a); return "s" + a; } }).m3;
lib.m4 = (class { static *m4(a = this === undefined ? 1 : 2) { say("eval", nested(a)); state.line = (state.line | 0) + 1; return Symbol.iterator; } }).m4;
lib.m5 = function* (a) { const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return [a, state.n]; };
function* m6(a) { return "s" + a; } lib.m6 = m6;
lib.m0.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; };
lib.m4.isEnd = true;
say(Object.getPrototypeOf(lib.m4.prototype) === Object.getPrototypeOf(inner.prototype));
lib.m6 = async function () { return 1; };
const rows = []; rows.push({ process: lib.m2, v: 0, skip: false }); rows.push({ process: lib.m4, v: 1, skip: undefined }); rows.push({ process: lib.m1, v: 2, skip: true }); rows.push({ process: lib.m4, v: 3, skip: undefined });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { for (let i = 0; i < 12; i++) { const row = table.get(i); if (row == null || row.skip == null) continue; state.last = yield* row["process"](i, 2, 3, 4, 5, 6, 7, 8); } return "end"; };
try { const it = run.run(); it.next(); say(typeof it.return("q").value); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { run.run().next(); } catch (x) { say(x.stack ? x.stack.split("\n").slice(0, 3).map(l => l.replace(/ *at ([^ ]*).*/, "$1")).join("|") : x); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
function* m0(a, b, c, d, e, f, g) { state.line = (state.line | 0) + 1; try { yield a; } finally { say("f", a); } say("sub", [...inner(a)].join()); fs.push(() => a); say("deeper", yield* lib.leaf(a, state)); return this; } lib.m0 = m0;
lib.m1 = ((k) => function* ({ length: a }) { try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } return 2 ** 31; })(1);
function* m2({ length: a }) { say("sent", yield a); say("b", typeof this, a); say("eval", nested(a)); if (a === 5 && state.n > 40) throw new TypeError("five"); return null; } lib.m2 = m2;
lib.m3 = ((k) => function* (a) { if (a === 5 && state.n > 40) throw new TypeError("five"); return -0; })(1);
function* m4(a, b = say("default")) { for (const x of [1, 2]) state.n += x; state.last = this; return null; } lib.m4 = m4;
lib.m5 = (class { static *m5(a) { say("b", typeof this, a); try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } for (const x of [1, 2]) state.n += x; return 10n; } }).m5;
lib.m0.isEnd = true;
lib.m0.prototype = null;
lib.m3.isEnd = true;
lib.m3 = 5;
const rows = []; rows.push({ process: lib.m3, v: 0, skip: true }); rows.push({ process: lib.m4, v: 1, skip: undefined }); rows.push({ process: lib.m5, v: 2, skip: undefined });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { let i = 0; while (i < 12) { const row = table.get(i++); if (!row || row.process == null || row.skip) continue; state.last = row; try { yield* row["process"](undefined); } finally { state.n++; } } return "end"; };
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
try { const it = run.run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 20) break; }  } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = { *m0({ length: a }) { say("sent", yield a); say("b", typeof this, a); state.line = (state.line | 0) + 1; say("deeper", yield* lib.leaf(a, state)); return 2 ** 31; } }.m0;
lib.m1 = function* (a = this === undefined ? 1 : 2) { state.line = (state.line | 0) + 1; say("b", typeof this, a); return 10n; };
lib.m2 = function* ({ length: a }) { try { yield a; } finally { say("f", a); } return Symbol.iterator; };
lib.m3 = function* (a, b, c, d, e, f, g) { fs.push(() => a); for (let i = 0; i < 2; i++) state.n += i; say("sub", [...inner(a)].join()); return this; };
function* m4(a = this === undefined ? 1 : 2) { for (const x of [1, 2]) state.n += x; say("b", typeof this, a); fs.push(() => a); return 10n; } lib.m4 = m4;
lib.m1.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; };
const rows = []; rows.push({ process: lib.m0, v: 0, skip: false }); rows.push({ process: lib.m4, v: 1, skip: false }); rows.push({ process: lib.m3, v: 2, skip: true }); rows.push({ process: lib.m2, v: 3, skip: true }); rows.push({ process: lib.m0, v: 4, skip: undefined }); rows.push({ process: lib.m1, v: 5, skip: false }); rows.push({ process: lib.m4, v: 6, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { for (let i = 0; i < 6; i++) { const row = table.get(i); if (row == null || row.skip == null) continue; yield* row.process.call(null, [i, 2]); } return "end"; } };
try { const it = run.run(); it.next(); say(typeof it.return("q").value); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = ((k) => function* (a, b) { if (a > 4) { state.n++; } yield "y" + a;  })(1);
lib.m1 = function* (a, ...rest) { const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return 2 ** 31; };
lib.m2 = function* (a, b) { say("eval", nested(a)); return this; };
lib.m3 = { *m3(a, b = say("default")) { if (a === 5 && state.n > 40) throw new TypeError("five"); fs.push(() => a); if (a === 5 && state.n > 40) throw new TypeError("five"); return lib.leaf(a, state); } }.m3;
lib.m4 = ((k) => function* ([a] = [7]) { for (let i = 0; i < 2; i++) state.n += i; say("sub", [...inner(a)].join()); const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return undefined; })(1);
lib.m5 = (class { static *m5(a, b) { return; } }).m5;
lib.m6 = (class { static *m6([a] = [7]) { if (a & 1) yield a; return [a, state.n]; } }).m6;
lib.m1 = (...x) => [1, 2];
lib.m3.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; };
lib.m4.prototype.extra = 1;
lib.m6.prototype = null;
const rows = []; rows.push({ process: lib.m2, v: 0, skip: undefined }); rows.push({ process: lib.m6, v: 1, skip: undefined }); rows.push({ process: lib.m1, v: 2, skip: true }); rows.push({ process: lib.m5, v: 3, skip: false }); rows.push({ process: lib.m4, v: 4, skip: true }); rows.push({ process: lib.m0, v: 5, skip: false }); rows.push({ process: lib.m2, v: 6, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { let i = 0; while (i < 12) { const row = table.get(i++); if (!row || row.process == null || row.skip) continue; state.last = row; yield* row.process("abc"); } return "end"; } };
try { run.run().next(); } catch (x) { say(x.stack ? x.stack.split("\n").slice(0, 3).map(l => l.replace(/ *at ([^ ]*).*/, "$1")).join("|") : x); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = (class { static *m0(a, ...rest) { this && (this.seen = (this.seen | 0) + 1); if (a & 1) yield a; return lib.leaf(a, state); } }).m0;
lib.m1 = (class { static *m1(a, b = say("default")) { try { yield a; } finally { say("f", a); } say("eval", nested(a)); return state; } }).m1;
lib.m2 = function* (a) { say("b", typeof this, a); fs.push(() => a); say("sub", [...inner(a)].join()); return { done: false, value: a }; };
lib.m3 = (class { static *m3(a, b) { if (a === 5 && state.n > 40) throw new TypeError("five"); if (a > 4) { state.n++; } say("eval", nested(a)); return; } }).m3;
function* m4([a] = [7]) { fs.push(() => a); state.n += 1; say("b", typeof this, a); return { done: false, value: a }; } lib.m4 = m4;
function* m5({ length: a }) { say("b", typeof this, a); state.last = this; return null; } lib.m5 = m5;
lib.m6 = ((k) => function* (a, b = say("default")) { return this; })(1);
lib.m1.isEnd = true;
lib.m1 = async function () { return 1; };
lib.m2.isEnd = true;
lib.m6.prototype.extra = 1;
const rows = []; rows.push({ process: lib.m0, v: 0, skip: false }); rows.push({ process: lib.m2, v: 1, skip: true }); rows.push({ process: lib.m3, v: 2, skip: false }); rows.push({ process: lib.m4, v: 3, skip: undefined }); rows.push({ process: lib.m5, v: 4, skip: true });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { for (let i = 0; i < 17; i++) { const row = table.get(i); if (row == null || row.skip == null) continue; yield* row.process?.(i, 2, 3, 4, 5, 6, 7, 8); } return "end"; } };
lib.deep = function* (d) { if (d > 0) { for (const k of [1]) { const row = rows2[0]; yield* row.process(d - 1); } } return d; }; const rows2 = [{ process: lib.deep }]; try { const it = lib.deep(50); say("deep", it.next().done); } catch (x) { say("deep", x.name); }
try { const it = run.run(); it.next(); say(typeof it.return("q").value); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { const it = run.run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 20) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = { *m0(a, ...rest) { fs.push(() => a); try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } return a; } }.m0;
lib.m1 = { *m1(a, b, c, d, e, f, g) { state.last = this; return 10n; } }.m1;
lib.m2 = { *m2(a) { say("sent", yield a); this && (this.seen = (this.seen | 0) + 1); for (const x of [1, 2]) state.n += x; say("eval", nested(a)); return null; } }.m2;
lib.m3 = { *m3(a, b) { state.line = (state.line | 0) + 1; fs.push(() => a); try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } return NaN; } }.m3;
lib.m4 = function* (a, b, c, d, e, f, g) { say("sub", [...inner(a)].join()); for (let i = 0; i < 2; i++) state.n += i; yield "y" + a; fs.push(() => a); return lib.leaf(a, state); };
lib.m0.isEnd = true;
lib.m3.isEnd = true;
lib.m3 = lib.m3.bind({ bound: 1 }, 2);
lib.m4.isEnd = true;
const rows = []; rows.push({ process: lib.m2, v: 0, skip: undefined }); rows.push({ process: lib.m4, v: 1, skip: false }); rows.push({ process: lib.m2, v: 2, skip: false }); rows.push({ process: lib.m3, v: 3, skip: undefined }); rows.push({ process: lib.m3, v: 4, skip: true });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { for (let i = 0; i < 17; i++) { const row = rows[i % rows.length]; try { say("got", yield* row.process([i, 2])); } catch (x) { say("caught", x && x.name, x && x.message); } } return "end"; } };
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
try { run.run().next(); } catch (x) { say(x.stack ? x.stack.split("\n").slice(0, 3).map(l => l.replace(/ *at ([^ ]*).*/, "$1")).join("|") : x); }
try { const it = run.run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 20) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = { *m0(a) { if (a > 4) { state.n++; } return NaN; } }.m0;
lib.m1 = (class { static *m1(a, b, c, d, e, f, g) { if (a === 5 && state.n > 40) throw new TypeError("five"); return -0; } }).m1;
lib.m2 = function* ({ length: a }) { for (let i = 0; i < 2; i++) state.n += i; for (const x of [1, 2]) state.n += x; for (let i = 0; i < 2; i++) state.n += i; return lib.leaf(a, state); };
const rows = []; rows.push({ process: lib.m0, v: 0, skip: true }); rows.push({ process: lib.m1, v: 1, skip: undefined }); rows.push({ process: lib.m0, v: 2, skip: false }); rows.push({ process: lib.m1, v: 3, skip: true }); rows.push({ process: lib.m1, v: 4, skip: undefined }); rows.push({ process: lib.m1, v: 5, skip: false }); rows.push({ process: lib.m2, v: 6, skip: undefined });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { for (let i = 0; i < 6; i++) { const row = table.get(i); if (row == null || row.skip == null) continue; say("got", yield* row.process?.("abc")); } return "end"; };
lib.deep = function* (d) { if (d > 0) { for (const k of [1]) { const row = rows2[0]; yield* row.process(d - 1); } } return d; }; const rows2 = [{ process: lib.deep }]; try { const it = lib.deep(50); say("deep", it.next().done); } catch (x) { say("deep", x.name); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = ((k) => function* (a, b = say("default")) { return -0; })(1);
lib.m1 = function* (a) { say("b", typeof this, a); try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } state.line = (state.line | 0) + 1; return 2 ** 31; };
lib.m2 = { *m2(a = this === undefined ? 1 : 2) { this && (this.seen = (this.seen | 0) + 1); return a; } }.m2;
function* m3([a] = [7]) { yield "y" + a; return -0; } lib.m3 = m3;
lib.m1.prototype = null;
const rows = []; rows.push({ process: lib.m3, v: 0, skip: true }); rows.push({ process: lib.m0, v: 1, skip: undefined }); rows.push({ process: lib.m2, v: 2, skip: true }); rows.push({ process: lib.m2, v: 3, skip: undefined }); rows.push({ process: lib.m3, v: 4, skip: undefined }); rows.push({ process: lib.m3, v: 5, skip: true }); rows.push({ process: lib.m3, v: 6, skip: true });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { for (let i = 0; i < 6; i++) { const row = table.get(i); if (row == null || row.skip == null) continue; try { say("got", yield* row.process?.(state)); } catch (x) { say("caught", x && x.name, x && x.message); } } return "end"; };
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { const it = run.run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 3) break; } say(JSON.stringify(it.throw(new Error("in")))); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = { *m0(a) { return [a, state.n]; } }.m0;
function* m1([a] = [7]) { yield "y" + a; say("deeper", yield* lib.leaf(a, state)); return Symbol.iterator; } lib.m1 = m1;
lib.m2 = (class { static *m2(a, b = say("default")) { say("b", typeof this, a); return 10n; } }).m2;
lib.m3 = (class { static *m3(a, ...rest) { state.last = this; say("sub", [...inner(a)].join()); fs.push(() => a); if (a & 1) yield a; return null; } }).m3;
lib.m4 = (class { static *m4(a, b) { say("eval", nested(a)); yield "y" + a; return undefined; } }).m4;
lib.m5 = (class { static *m5({ length: a }) { this && (this.seen = (this.seen | 0) + 1); if (a > 4) { state.n++; } for (let i = 0; i < 2; i++) state.n += i; const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return null; } }).m5;
lib.m0.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); };
lib.m1.isEnd = true;
const rows = []; rows.push({ process: lib.m0, v: 0, skip: true }); rows.push({ process: lib.m2, v: 1, skip: undefined }); rows.push({ process: lib.m0, v: 2, skip: undefined }); rows.push({ process: lib.m0, v: 3, skip: true }); rows.push({ process: lib.m5, v: 4, skip: false }); rows.push({ process: lib.m1, v: 5, skip: false }); rows.push({ process: lib.m1, v: 6, skip: true });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { for (let i = 0; i < 17; i++) { const row = rows[i % rows.length]; say("got", yield* row["process"](i, state)); } return "end"; };
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { const it = run.run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 3) break; } say(JSON.stringify(it.throw(new Error("in")))); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
