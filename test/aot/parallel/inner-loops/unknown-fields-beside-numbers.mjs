// Inner loops that take unknown fields beside numbers and read off unknown values in some iterations.
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = { other: m, statements: m };
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; do { if (++turns > 60) break; s.check(s.n !== 12, "c4"); s.check(s.last < s.k, "c1"); { const x = prog.statements.get(s.n); if (x == null || x.p == null) { s.last = 1; } say("x", x.p, x.q); } s.n++; } while (s.n < limit); yield i; say(s.k); } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(seen(1), 7), 9, 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(2, 7), 9, 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State("1", 7), seen(8), 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = tables;
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; const y7195 = list[s.k % 9]; acc += (s.last <= limit) ? 1 : 0; acc += s.n - 1; if (i == 1 && t == 2) s.n = null; { const x = prog.statements.get(s.n); if (x == null || x.p == null) { s.last = 1; } say("x", x.p, x.q); } s.n++; }  s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(null, 7), 13, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(2, 7), 13, 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(2, 7), "7", 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = { other: m, statements: m };
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n < limit) { if (++turns > 60) break; const y4218 = list[s.k % 9]; if (s.max > s.max) { continue; } s.k = s.n + i; s.k = s.last - limit; s.n++; }  s.last = s.n; s.n = 1; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(null, 7), seen(8), 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State("1", 7), "7", 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State("1", 7), 9, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = { other: m, statements: m };
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; try { { const x = prog.statements.get(s.n); if (x == null || x.p == null) s.k += 1; say("x", x.p, x.q); } } catch (z) { say("c", z && z.message ? z.constructor.name : z); } if (s.n >= limit) { say(s.n); } s.bump(); s.n++; }  s.last = s.n; s.n = 1; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(0, 7), seen(8), 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(null, 7), seen(8), 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(null, 7), 9, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; do { if (++turns > 60) break; acc += s.n + 1; if (t == 1) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } s.bump(); s.n++; } while (s.n < limit); yield i; say(s.k); } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(0, 7), 5.5, 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(0.5, 7), 9, 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(seen(1), 7), "7", 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = tables;
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; do { if (++turns > 60) break; if (i == 0 && t == 2) s.n = [3]; { const x = prog.statements.get(s.n); if (x == null || x.p == null) { s.last = 1; } say("x", x.p, x.q); } if (s.n != i) { s.last = i; } s.check(s.last < limit, "c1"); { const x = prog.statements.get(s.n); if (x == null || x.p == null) s.k += 1; say("x", x.p, x.q); } s.n++; } while (s.n < limit);  say(s.k); } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(2, 7), 6, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0.5, 7), "7", 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(null, 7), seen(8), 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; s.k = s.last + s.max; acc += (s.n >= limit) ? 1 : 0; if (i == 3 && t == 0) s.n = s.n + 0.5; s.check(s.last >= 5, "c0"); { const x = prog.statements.get(s.n); if (x == null || x.p == null) s.k += 1; say("x", x.p, x.q); } s.n++; }  s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(seen(1), 7), seen(8), 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(seen(1), 7), "7", 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(seen(1), 7), seen(8), 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(tables.other);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n < limit) { if (++turns > 60) break; s.check(s.n !== s.max, "c2"); acc += s.n - 1; s.check(s.n >= 12, "c0"); const y2329 = list[s.k % 9]; s.n++; } yield i; s.last = s.n; s.n = 1; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(0, 7), seen(8), 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State("1", 7), seen(8), 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(1, 7), 13, 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(tables.other);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; if (s.k < s.max) { s.k++; } acc += (s.k <= 5) ? 1 : 0; if (t == 0) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } acc += s.last * 1; s.n++; } yield i; s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State("1", 7), 13, 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(seen(1), 7), "7", 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(2, 7), "7", 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; for (let j = 0; j < limit; j++) { if (++turns > 60) break; if (i == 3 && t == 0) s.n = String(s.n); try { if (t == 0) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } } catch (z) { say("c", z && z.message ? z.constructor.name : z); } if (i == 2 && t == 0) s.n = Symbol.iterator; s.n++; }  s.last = s.n; s.n = 1; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(2, 7), 6, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(2, 7), 6, 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0.5, 7), 5.5, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; for (; s.n < limit;) { if (++turns > 60) break; s.n++; if (i == 3 && t == 0) s.n = 10n; s.n++; }  s.n = i; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(-3, 7), 5.5, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State("1", 7), 13, 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0.5, 7), 5.5, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = { other: m, statements: m };
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; s.k = s.n * limit; s.k = s.n * 5; s.n++; s.check(s.k != limit, "c3"); s.n++; s.n++; }  s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(seen(1), 7), "7", 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(null, 7), 6, 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(-3, 7), 9, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = { other: m, statements: m };
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n < limit) { if (++turns > 60) break; if (i == 0) { State.prototype.stop = function (t) { say("other stop", t); }; } s.n++; if (i == 2) { delete s.max; } s.n++; } yield i; s.n = i; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(seen(1), 7), seen(8), 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State("1", 7), "7", 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(2, 7), seen(8), 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; if (i == 0 && t == 0) s.n = null; { const x = prog.statements.get(s.n); if (x == null || x.p == null) { s.last = 1; } say("x", x.p, x.q); } const y7736 = list[s.k % 9]; if (i == 0) { Object.freeze(s); } s.n++; }  say(s.k); } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(1, 7), seen(8), 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0, 7), "7", 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(seen(1), 7), seen(8), 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(tables.other);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n < limit) { if (++turns > 60) break; { const x = prog.statements.get(s.n); if (x == null || x.p == null) continue; say("x", x.p, x.q); } acc += s.max - 1; acc += (s.n < limit) ? 1 : 0; if (i == 0) { State.prototype.check = function () { say("other check"); }; } s.n++; s.n++; } yield i; s.n = i; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(2, 7), 6, 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State("1", 7), 5.5, 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(-3, 7), 13, 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = tables;
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; for (; s.n < limit;) { if (++turns > 60) break; if (t == 2) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } if (s.n <= i) { break; } try { const w4718 = prog.statements.get(s.n++); } catch (z) { say("c", z && z.message ? z.constructor.name : z); } if (t == 1) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } acc += s.n - 1; s.n++; }  s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(null, 7), 13, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(-3, 7), seen(8), 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(1, 7), 6, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; { const x = prog.statements.get(s.n); if (x == null || x.p == null) { s.last = 1; } say("x", x.p, x.q); } s.check(s.last !== i, "c6"); if (i == 0 && t == 2) s.n = seen(s.n); if (i == 1 && t == 1) s.n = Symbol.iterator; s.n++; }  s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(1, 7), seen(8), 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0, 7), 5.5, 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0, 7), 9, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n != null && s.n <= limit) { if (++turns > 60) break; if (i == 0 && t == 2) s.n = undefined; if (s.last < s.k) { say(s.n); } s.n++; }  s.n = i; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(-3, 7), 9, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0.5, 7), seen(8), 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(2, 7), seen(8), 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n < limit) { if (++turns > 60) break; s.bump(); s.n++; try { const w7328 = prog.statements.get(s.n++); } catch (z) { say("c", z && z.message ? z.constructor.name : z); } s.bump(); acc += s.max + 1; s.n++; }  s.last = s.n; s.n = 1; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(0.5, 7), 6, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(-3, 7), 5.5, 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(seen(1), 7), seen(8), 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = maker(m);
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; for (let j = 0; j < limit; j++) { if (++turns > 60) break; s.check(s.last < limit, "c8"); if (t == 1) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } if (t == 0) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } if (s.max < limit) { say(s.n); } s.n++; }  say(s.k); } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(0, 7), "7", 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(-3, 7), 13, 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(seen(1), 7), 9, 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = tables;
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; do { if (++turns > 60) break; if (s.n < 12) { continue; } if (t == 1) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } s.k = s.n * limit; s.n++; } while (s.n < limit); yield i; s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(0, 7), 9, 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(2, 7), seen(8), 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State("1", 7), "7", 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = tables;
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; while (s.n < limit) { if (++turns > 60) break; { const x = prog.statements.get(s.n); if (x == null || x.p == null) { s.last = 1; } say("x", x.p, x.q); } try { if (t == 1) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } } catch (z) { say("c", z && z.message ? z.constructor.name : z); } s.k = s.n * limit; s.n++; } yield i; s.last = s.n; s.n = 1; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(2, 7), 9, 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(0, 7), seen(8), 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(0.5, 7), seen(8), 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = tables;
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; for (let j = 0; j < limit; j++) { if (++turns > 60) break; if (i == 0) { Object.freeze(s); } if (t == 0) { const z = list[(s.n | 0) % 9]; if (z != null) say("z", z.length, z.p); } { const x = prog.statements.get(s.n); if (x == null || x.p == null) s.k += 1; say("x", x.p, x.q); } s.k = s.k + 5; s.n++; }  s.last = s.n; s.n = 1; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { say("r", run(new State(-3, 7), 6, 0)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0.5, 7), "7", 1)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { say("r", run(new State(0.5, 7), "7", 2)); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 300) out.push(a.map(x => typeof x === "symbol" ? "symbol" : typeof x === "object" && x ? "object" : String(x)).join(" ")); return a[0]; };
class State { constructor(n, max) { this.n = n; this.max = max; this.k = 0; this.last = null; this.text = ""; } stop(t) { throw new Error("stop " + t); } check(p, t) { if (!p) this.stop(t); } bump() { this.k++; return this.k; } }
const seen = v => ({ valueOf() { say("valueOf", v); return v; }, toString() { say("toString"); return String(v); } });
const m = new Map([[2, { p: 1, q: "a" }], [4, { q: 2, p: seen(3) }], [6, null], [7, "str"], [8, { get p() { say("get p"); return 5; } }], [9, new Proxy({ p: 4 }, { get(t, k) { say("proxy", k); return t[k]; } })], [11, 12]]); const tables = { statements: m, other: new Map([[3, { p: null }]]) };
function maker(v) { return { statements: v, k: 1 }; } const prog = tables;
const list = [1, "two", null, { p: 3, length: 9 }, undefined, [1, 2], 4.5, seen(6), { get length() { say("get length"); return 2; } }];
function* run(s, limit, t) { let acc = 0; for (let i = 0; i < 4; i++) { let turns = 0; for (let j = 0; j < limit; j++) { if (++turns > 60) break; const y7555 = list[s.k % 9]; if (s.n !== 12) { continue; } if (i == 2 && t == 2) s.n = null; acc += (s.last < 5) ? 1 : 0; const y5203 = list[s.k % 9]; s.n++; } yield i; s.n = 0; } say("acc", acc, s.n, s.k, s.text.length); return acc; }
try { for (const x of run(new State(seen(1), 7), 6, 0)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(1, 7), 13, 1)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
try { for (const x of run(new State(-3, 7), 5.5, 2)) say("y", x); } catch (z) { say("threw", z && z.constructor && z.constructor.name, z instanceof TypeError ? "" : z && z.message); }
console.log(out.join("\n"));
})();
