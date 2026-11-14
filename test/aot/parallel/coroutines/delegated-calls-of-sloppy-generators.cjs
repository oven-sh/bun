// The same with functions that are not strict.
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
function* m0(a, ...rest) { say("b", typeof this, a); try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } return null; } lib.m0 = m0;
lib.m1 = function* (a, b, c, d, e, f, g) { state.n += 1; return; };
function* m2(a, b, c, d, e, f, g) { this && (this.seen = (this.seen | 0) + 1); return -0; } lib.m2 = m2;
lib.m3 = function* ({ length: a }) { say("sub", [...inner(a)].join()); if (a === 5 && state.n > 40) throw new TypeError("five"); if (a & 1) yield a; say("deeper", yield* lib.leaf(a, state));  };
lib.m3.prototype = { next() { say("own next"); return { done: true, value: "n" }; }, [Symbol.iterator]() { return this; } };
const rows = []; rows.push({ process: lib.m0, v: 0, skip: false }); rows.push({ process: lib.m2, v: 1, skip: true }); rows.push({ process: lib.m2, v: 2, skip: false }); rows.push({ process: lib.m1, v: 3, skip: true }); rows.push({ process: lib.m1, v: 4, skip: true }); rows.push({ process: lib.m2, v: 5, skip: false }); rows.push({ process: lib.m2, v: 6, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { let i = 0; while (i < 17) { const row = table.get(i++); if (!row || row.process == null || row.skip) continue; state.last = row; state.last = yield* row["process"](state); } return "end"; };
try { const it = run.run(); it.next(); say(typeof it.return("q").value); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.name, x && x.message); }
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = ((k) => function* (a, b) { state.line = (state.line | 0) + 1; state.last = this; say("sub", [...inner(a)].join()); return -0; })(1);
function* m1([a] = [7]) { for (let i = 0; i < 2; i++) state.n += i; try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } return { done: false, value: a }; } lib.m1 = m1;
lib.m2 = ((k) => function* ([a] = [7]) { say("b", typeof this, a); if (a === 5 && state.n > 40) throw new TypeError("five"); say("sub", [...inner(a)].join()); return a; })(1);
lib.m3 = { *m3(a = this === undefined ? 1 : 2) { state.line = (state.line | 0) + 1; try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } return NaN; } }.m3;
lib.m4 = function* (a, b = say("default")) { yield "y" + a; return state; };
lib.m5 = ((k) => function* (a, b, c, d, e, f, g) { for (const x of [1, 2]) state.n += x; for (let i = 0; i < 2; i++) state.n += i; return Symbol.iterator; })(1);
function* m6(a, b) { state.last = this; say("sub", [...inner(a)].join()); const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return [a, state.n]; } lib.m6 = m6;
lib.m1.isEnd = true;
lib.m3.isEnd = true;
lib.m3.prototype = { next() { say("own next"); return { done: true, value: "n" }; }, [Symbol.iterator]() { return this; } };
lib.m5.isEnd = true;
const rows = []; rows.push({ process: lib.m0, v: 0, skip: false }); rows.push({ process: lib.m4, v: 1, skip: true }); rows.push({ process: lib.m0, v: 2, skip: true }); rows.push({ process: lib.m5, v: 3, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { let i = 0; while (i < 6) { const row = table.get(i++); if (!row || row.process == null || row.skip) continue; state.last = row; try { yield* row["process"](i); } finally { state.n++; } } return "end"; };
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = { *m0([a] = [7]) { if (a === 5 && state.n > 40) throw new TypeError("five"); return 10n; } }.m0;
lib.m1 = (class { static *m1({ length: a }) { return "s" + a; } }).m1;
lib.m2 = { *m2({ length: a }) { for (const x of [1, 2]) state.n += x; say("sub", [...inner(a)].join()); state.last = this; return -0; } }.m2;
lib.m3 = { *m3(a, b = say("default")) { this && (this.seen = (this.seen | 0) + 1); yield "y" + a; say("eval", nested(a)); say("sub", [...inner(a)].join()); return -0; } }.m3;
lib.m4 = function* (a = this === undefined ? 1 : 2) { say("sent", yield a); state.line = (state.line | 0) + 1; say("sub", [...inner(a)].join()); say("deeper", yield* lib.leaf(a, state)); return a; };
lib.m5 = function* ({ length: a }) { if (a === 5 && state.n > 40) throw new TypeError("five");  };
lib.m0.isEnd = true;
lib.m3.prototype = null;
const rows = []; rows.push({ process: lib.m0, v: 0, skip: true }); rows.push({ process: lib.m1, v: 1, skip: true }); rows.push({ process: lib.m5, v: 2, skip: false }); rows.push({ process: lib.m5, v: 3, skip: true }); rows.push({ process: lib.m4, v: 4, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { let i = 0; while (i < 12) { const row = table.get(i++); if (row == null) continue; try { yield* row.process.call(null); } finally { state.n++; } } return "end"; } };
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
function* m0({ length: a }) { state.line = (state.line | 0) + 1; const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return "s" + a; } lib.m0 = m0;
lib.m1 = { *m1([a] = [7]) { for (let i = 0; i < 2; i++) state.n += i; for (const x of [1, 2]) state.n += x; say("sent", yield a); this && (this.seen = (this.seen | 0) + 1); say("deeper", yield* lib.leaf(a, state)); return -0; } }.m1;
lib.m2 = { *m2(a, b, c, d, e, f, g) { this && (this.seen = (this.seen | 0) + 1); for (const x of [1, 2]) state.n += x; say("eval", nested(a)); return undefined; } }.m2;
function* m3([a] = [7]) { if (a === 5 && state.n > 40) throw new TypeError("five"); try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } if (a === 5 && state.n > 40) throw new TypeError("five"); const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return Symbol.iterator; } lib.m3 = m3;
lib.m4 = (class { static *m4({ length: a }) { state.last = this; say("b", typeof this, a); say("sub", [...inner(a)].join()); return "s" + a; } }).m4;
lib.m5 = { *m5(a, b = say("default")) { state.n += 1; state.n += 1; for (const x of [1, 2]) state.n += x; return NaN; } }.m5;
lib.m6 = { *m6(a) { say("eval", nested(a)); say("sub", [...inner(a)].join()); for (let i = 0; i < 2; i++) state.n += i; return Symbol.iterator; } }.m6;
lib.m3.isEnd = true;
lib.m4.isEnd = true;
lib.m6.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); };
const rows = []; rows.push({ process: lib.m0, v: 0, skip: true }); rows.push({ process: lib.m1, v: 1, skip: false }); rows.push({ process: lib.m6, v: 2, skip: false }); rows.push({ process: lib.m2, v: 3, skip: true }); rows.push({ process: lib.m4, v: 4, skip: true }); rows.push({ process: lib.m1, v: 5, skip: undefined });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { for (let i = 0; i < 17; i++) { const row = table.get(i); if (row == null || row.skip == null) continue; const v = yield* row["process"](undefined); say(typeof v); } return "end"; } };
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
try { const it = run.run(); it.next(); say(typeof it.return("q").value); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = ((k) => function* ({ length: a }) { return 2 ** 31; })(1);
lib.m1 = function* (a, b, c, d, e, f, g) { if (a > 4) { state.n++; } fs.push(() => a); return a; };
lib.m2 = { *m2(a, b = say("default")) { return null; } }.m2;
lib.m3 = (class { static *m3(a, ...rest) { return 10n; } }).m3;
lib.m4 = function* (a = this === undefined ? 1 : 2) { for (let i = 0; i < 2; i++) state.n += i; this && (this.seen = (this.seen | 0) + 1); try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } return lib.leaf(a, state); };
lib.m5 = ((k) => function* (a, b = say("default")) { for (let i = 0; i < 2; i++) state.n += i; if (a > 4) { state.n++; } say("sub", [...inner(a)].join()); return "s" + a; })(1);
lib.m0.isEnd = true;
Object.freeze(lib.m0);
lib.m1.isEnd = true;
lib.m3.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; };
lib.m4.isEnd = true;
lib.m5.isEnd = true;
const rows = []; rows.push({ process: lib.m4, v: 0, skip: false }); rows.push({ process: lib.m5, v: 1, skip: false }); rows.push({ process: lib.m0, v: 2, skip: false }); rows.push({ process: lib.m1, v: 3, skip: true }); rows.push({ process: lib.m2, v: 4, skip: undefined }); rows.push({ process: lib.m3, v: 5, skip: undefined });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { let i = 0; while (i < 17) { const row = table.get(i++); if (row == null) continue; say("got", yield* (0, row.process)(i)); } return "end"; } };
try { const it = run.run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 20) break; } say(JSON.stringify(it.throw(new Error("in")))); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = { *m0(a = this === undefined ? 1 : 2) { this && (this.seen = (this.seen | 0) + 1); if (a === 5 && state.n > 40) throw new TypeError("five"); return this; } }.m0;
lib.m1 = function* (a, b, c, d, e, f, g) { say("sent", yield a); say("deeper", yield* lib.leaf(a, state)); return [a, state.n]; };
lib.m2 = { *m2(a) { if (a === 5 && state.n > 40) throw new TypeError("five"); for (let i = 0; i < 2; i++) state.n += i; return null; } }.m2;
const rows = []; rows.push({ process: lib.m1, v: 0, skip: undefined }); rows.push({ process: lib.m1, v: 1, skip: false }); rows.push({ process: lib.m0, v: 2, skip: undefined }); rows.push({ process: lib.m0, v: 3, skip: undefined });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { for (let i = 0; i < 6; i++) { const row = rows[i % rows.length]; state.last = yield* row.process(i, 2, 3, 4, 5, 6, 7, 8); } return "end"; };
lib.deep = function* (d) { if (d > 0) { for (const k of [1]) { const row = rows2[0]; yield* row.process(d - 1); } } return d; }; const rows2 = [{ process: lib.deep }]; try { const it = lib.deep(50); say("deep", it.next().done); } catch (x) { say("deep", x.name); }
try { const it = run.run(); it.next(); say(typeof it.return("q").value); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = function* ({ length: a }) { return this; };
lib.m1 = function* ({ length: a }) { try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } if (a > 4) { state.n++; } say("sub", [...inner(a)].join()); return -0; };
function* m2(a, b, c, d, e, f, g) { if (a > 4) { state.n++; } say("sent", yield a); say("b", typeof this, a); say("deeper", yield* lib.leaf(a, state)); return 10n; } lib.m2 = m2;
lib.m3 = (class { static *m3(a) { state.last = this; if (a === 5 && state.n > 40) throw new TypeError("five"); return NaN; } }).m3;
lib.m4 = function* (a, ...rest) { if (a & 1) yield a; say("sub", [...inner(a)].join());  };
lib.m5 = function* (a, ...rest) { state.line = (state.line | 0) + 1; say("b", typeof this, a); fs.push(() => a); const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return [a, state.n]; };
lib.m0.isEnd = true;
lib.m0 = new Proxy(lib.m0, { apply(t, self, list) { say("apply"); return Reflect.apply(t, self, list); } });
lib.m3.isEnd = true;
lib.m4.isEnd = true;
const rows = []; rows.push({ process: lib.m0, v: 0, skip: undefined }); rows.push({ process: lib.m2, v: 1, skip: undefined }); rows.push({ process: lib.m1, v: 2, skip: undefined }); rows.push({ process: lib.m3, v: 3, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { for (let i = 0; i < 12; i++) { const row = table.get(i); if (row === undefined || row.v > 4) { say("skip", i); continue; } yield* row.process([i, 2]); if (i == 9) yield "nine"; } return "end"; };
lib.deep = function* (d) { if (d > 0) { for (const k of [1]) { const row = rows2[0]; yield* row.process(d - 1); } } return d; }; const rows2 = [{ process: lib.deep }]; try { const it = lib.deep(2000); say("deep", it.next().done); } catch (x) { say("deep", x.name); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = function* ([a] = [7]) { try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } fs.push(() => a); yield "y" + a; return a; };
lib.m1 = function* (a = this === undefined ? 1 : 2) { try { yield a; } finally { say("f", a); } state.last = this; state.n += 1;  };
lib.m2 = function* (a, ...rest) { state.line = (state.line | 0) + 1; state.last = this; this && (this.seen = (this.seen | 0) + 1); return 2 ** 31; };
lib.m3 = { *m3(a = this === undefined ? 1 : 2) { return a; } }.m3;
lib.m4 = (class { static *m4(a, b) { return lib.leaf(a, state); } }).m4;
lib.m5 = (class { static *m5(a, b) { const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return 2 ** 31; } }).m5;
lib.m6 = (class { static *m6({ length: a }) { if (a & 1) yield a; return null; } }).m6;
lib.m1.isEnd = true;
lib.m2 = lib.m2.bind({ bound: 1 }, 2);
const rows = []; rows.push({ process: lib.m2, v: 0, skip: false }); rows.push({ process: lib.m4, v: 1, skip: true }); rows.push({ process: lib.m4, v: 2, skip: true }); rows.push({ process: lib.m1, v: 3, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = { *run(p) { for (let i = 0; i < 12; i++) { const row = table.get(i); if (row === undefined || row.v > 4) { say("skip", i); continue; } say("got", yield* row["process"]([i, 2])); if (i == 9) yield "nine"; } return "end"; } };
lib.deep = function* (d) { if (d > 0) { for (const k of [1]) { const row = rows2[0]; yield* row.process(d - 1); } } return d; }; const rows2 = [{ process: lib.deep }]; try { const it = lib.deep(50); say("deep", it.next().done); } catch (x) { say("deep", x.name); }
try { const it = run.run(); it.next(); say(typeof it.return("q").value); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = (class { static *m0({ length: a }) { return undefined; } }).m0;
lib.m1 = { *m1(a, b, c, d, e, f, g) { say("eval", nested(a)); state.last = this; if (a === 5 && state.n > 40) throw new TypeError("five"); const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next()));  } }.m1;
lib.m2 = ((k) => function* (a, b, c, d, e, f, g) { for (let i = 0; i < 2; i++) state.n += i; return 10n; })(1);
lib.m3 = function* (a, b) { if (a > 4) { state.n++; } state.last = this;  };
lib.m4 = function* (a) { try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } say("sub", [...inner(a)].join()); state.last = this; return NaN; };
lib.m0 = new Proxy(lib.m0, { apply(t, self, list) { say("apply"); return Reflect.apply(t, self, list); } });
lib.m2.isEnd = true;
lib.m3.isEnd = true;
const rows = []; rows.push({ process: lib.m1, v: 0, skip: false }); rows.push({ process: lib.m0, v: 1, skip: undefined }); rows.push({ process: lib.m4, v: 2, skip: true }); rows.push({ process: lib.m2, v: 3, skip: false }); rows.push({ process: lib.m4, v: 4, skip: undefined }); rows.push({ process: lib.m4, v: 5, skip: undefined }); rows.push({ process: lib.m1, v: 6, skip: undefined }); rows.push({ process: lib.m4, v: 7, skip: true });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { let i = 0; while (i < 12) { const row = table.get(i++); if (row == null) continue; const v = yield* row.process(); say(typeof v); } return "end"; };
try { const it = run.run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const fs = []; const say = (...a) => { out.push(a.map(x => typeof x === "object" && x ? (Array.isArray(x) ? "list " + x.length : "object") : typeof x === "symbol" || typeof x === "bigint" ? typeof x : Object.is(x, -0) ? "-0" : String(x)).join(" ")); };
const state = { n: 0, line: 0, last: null }; function* inner(k) { yield k; return k; } const nested = x => x;
const lib = {}; lib.leaf = function* (a, s) { s.n += 2; return a; };
lib.m0 = { *m0(a, b, c, d, e, f, g) { try { if (a === 3) throw new Error("in " + a); } catch (x) { say("caught inside", x.message); } finally { state.n ^= 1; } for (const x of [1, 2]) state.n += x; this && (this.seen = (this.seen | 0) + 1); try { yield a; } finally { say("f", a); } return null; } }.m0;
lib.m1 = ((k) => function* (a) { say("sub", [...inner(a)].join()); for (let i = 0; i < 2; i++) state.n += i; return null; })(1);
function* m2({ length: a }) { return; } lib.m2 = m2;
function* m3(a = this === undefined ? 1 : 2) { const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return Symbol.iterator; } lib.m3 = m3;
lib.m4 = { *m4(a, b = say("default")) { return 2 ** 31; } }.m4;
function* m5(a, b) { for (const x of [1, 2]) state.n += x; say("b", typeof this, a); fs.push(() => a); return; } lib.m5 = m5;
function* m6(a, ...rest) { state.line = (state.line | 0) + 1; say("sub", [...inner(a)].join()); state.last = this; const kept = lib.leaf(a, state); say("kept", typeof kept.next, JSON.stringify(kept.next())); return { done: false, value: a }; } lib.m6 = m6;
lib.m1 = new Proxy(lib.m1, { apply(t, self, list) { say("apply"); return Reflect.apply(t, self, list); } });
lib.m3.isEnd = true;
const rows = []; rows.push({ process: lib.m3, v: 0, skip: undefined }); rows.push({ process: lib.m5, v: 1, skip: undefined }); rows.push({ process: lib.m2, v: 2, skip: undefined }); rows.push({ process: lib.m1, v: 3, skip: undefined }); rows.push({ process: lib.m2, v: 4, skip: false });
const table = new Map(); rows.forEach((row, i) => table.set(i * 2, row));
const run = {}; run.run = function* (p) { for (let i = 0; i < 17; i++) { const row = table.get(i); if (row == null || row.skip == null) continue; state.last = yield* row.process(state); } return "end"; };
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { say([...run.run()].length); } catch (x) { say("threw", x && x.name, x && x.message); }
try { for (const x of run.run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.name, x && x.message); }
say(state.n, state.line, fs.length, fs.slice(0, 3).map(f => typeof f()).join()); console.log(out.slice(0, 500).join("\n"));
})();
