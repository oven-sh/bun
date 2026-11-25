// Calls of functions that throw on every way, in loops, conditions, arguments, tries and finallys.
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const fail0 = x => { throw new Error("zero"); };
class K1 { constructor(v) { this.v = v; } stop(x) { throw new Error("f1 " + x); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { throw new Error("f1 " + x); } get g() { const x = this.v; throw new Error("f1 " + x); } } const k1 = new K1(1); function fail1(x) { return k1.stop(x); }
class K2 { constructor(v) { this.v = v; } stop(x) { say("in", x); throw new Error("said"); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { say("in", x); throw new Error("said"); } get g() { const x = this.v; say("in", x); throw new Error("said"); } } const k2 = new K2(2); function fail2(x) { return k2.stop(x); }
class K3 { constructor(v) { this.v = v; } stop(x) { throw new Error("f3 " + x); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { throw new Error("f3 " + x); } get g() { const x = this.v; throw new Error("f3 " + x); } } const k3 = new K3(3); function fail3(x) { return k3.stop(x); }
const fail4 = x => { throw x; };
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
async function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(j === 3)) { sum += j; } else { K1.bad(j); sum += 1000; } switch (j) { case 1: sum++; break; case 2: K1.bad(j); default: sum += 2; } try { try { switch (j) { case 1: sum++; break; case 2: k3.check(j < 2, 7); default: sum += 2; } } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } await null; } say("sum", sum); return sum; }
function* run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { sum += list[j] | 0; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } try { if (state.map.get(j) == null) (j, k1.g); } finally { say("f", j);  } const t7054 = j === 3 ? (j, k3.g) : j; yield j; } say("sum", sum); return sum; }
function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { const t5488 = !(list[j] >= 0) ? k2.check(j < 2, 7) : j; } finally { say("f", j);  } state.n = j; state.k += state.n; const u5836 = list[j] ?? k2.check(j < 2, 7); say("v", j, typeof list[j] !== "number" && (j, k2.g)); const t860 = typeof list[j] !== "number" ? k3.stop(j) : j;  } say("sum", sum); return sum; }
await (async () => {
try { say("r", await run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(2)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { if (x === 4) return say("four"); throw new Error("not four"); }, v: 0 }; function fail0(x) { o0.stop(x); }
const o1 = { stop(x) { switch (x % 2) { case 0: throw new Error("even"); default: throw new RangeError("odd"); } }, v: 1 }; function fail1(x) { o1.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { const t2746 = state.map.get(j) == null ? fail0(j) : j; } finally { say("f", j); continue; } try { if (state.k > 9) o1.stop(j); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } say("v", j, state.map.get(j) == null && fail1(j));  } say("sum", sum); return sum; }
function* run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { say("v", j, j === 3 && fail1(j)); try { state.n = j; state.k += state.n; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; } sum += list[j] | 0; if (typeof list[j] !== "number") fail0(j); yield j; } say("sum", sum); return sum; }
function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += list[j] | 0; const t8609 = state.k > 9 ? o0.stop(j) : j; if (!(state.map.get(j) == null)) { sum += j; } else { o0.stop(j); sum += 1000; } if (!(state.k > 9)) { sum += j; } else { o0.stop(j); sum += 1000; }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(3)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
class K0 { constructor(v) { this.v = v; } stop(x) { try { throw new Error("a" + x); } finally { state.n++; } } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { try { throw new Error("a" + x); } finally { state.n++; } } get g() { const x = this.v; try { throw new Error("a" + x); } finally { state.n++; } } } const k0 = new K0(0); function fail0(x) { return k0.stop(x); }
function fail1(x) { try { throw new Error("a" + x); } finally { state.n++; } }
const o2 = { stop(x) { fail0(x); }, v: 2 }; function fail2(x) { o2.stop(x); }
function fail3(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } }
class K4 { constructor(v) { this.v = v; } stop(x) { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } get g() { const x = this.v; for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } } const k4 = new K4(4); function fail4(x) { return k4.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(list[j] >= 0)) K0.bad(j); try { sum += list[j] | 0; } finally { say("f", j);  } try { if (!(state.map.get(j) == null)) { sum += j; } else { (j, k4.g); sum += 1000; } } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; } sum += say(state.k > 9 || 1) ? 1 : 2;  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); } function assert0(p, x) { if (!p) fail0(x); }
const o1 = { stop(x) { if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); }, v: 1 }; function fail1(x) { o1.stop(x); }
const fail2 = x => { throw x; };
function fail3(x) { fail0(x); }
function fail4(x) { say("in", x); throw new Error("said"); } function assert4(p, x) { if (!p) fail4(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function* run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { if (j === 3) fail3(j); } finally { say("f", j); continue; } sum += list[j] | 0; if (!(typeof list[j] !== "number")) { sum += j; } else { fail4(j); sum += 1000; }  } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (typeof list[j] !== "number") fail3(j); const t9427 = state.k > 9 ? fail1(j) : j; try { try { sum += say(j > 4 || 1) ? 1 : 2; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } const t7430 = !(list[j] >= 0) ? fail4(j) : j; if (j === 3) o1.stop(j);  } say("sum", sum); return sum; }
function* run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += say(typeof list[j] !== "number" || 1) ? 1 : 2; try { state.n = j; state.k += state.n; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; } yield j; } say("sum", sum); return sum; }
await (async () => {
try { for (const x of run0(2)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(3)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
class K0 { constructor(v) { this.v = v; } stop(x) { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } get g() { const x = this.v; for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } } const k0 = new K0(0); function fail0(x) { return k0.stop(x); }
function fail1(x) { switch (x % 2) { case 0: throw new Error("even"); default: throw new RangeError("odd"); } } function assert1(p, x) { if (!p) fail1(x); }
class K2 { constructor(v) { this.v = v; } stop(x) { say("in", x); throw new Error("said"); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { say("in", x); throw new Error("said"); } get g() { const x = this.v; say("in", x); throw new Error("said"); } } const k2 = new K2(2); function fail2(x) { return k2.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
async function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (typeof list[j] !== "number") k0.stop(j); if (!(state.k > 9)) { sum += j; } else { assert1(j != 3, 3); sum += 1000; }  } say("sum", sum); return sum; }
async function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += list[j] | 0; state.n = j; state.k += state.n; await null; } say("sum", sum); return sum; }
function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += list[j] | 0; state.n = j; state.k += state.n; sum += say(typeof list[j] !== "number" || 1) ? 1 : 2;  } say("sum", sum); return sum; }
await (async () => {
try { say("r", await run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } }, v: 0 }; function fail0(x) { o0.stop(x); }
function fail1(x) { try { null.y; } catch (z) { throw new Error("caught " + (z instanceof TypeError)); } }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { const t9925 = state.k > 9 ? fail0(j) : j; if (state.map.get(j) == null) fail0(j);  } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += say(j > 2 || 1) ? 1 : 2; if (!(j === 3)) { sum += j; } else { fail1(j); sum += 1000; } say("v", j, state.map.get(j) == null && fail1(j)); try { switch (j) { case 1: sum++; break; case 2: fail1(j); default: sum += 2; } } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } if (!(state.map.get(j) == null)) { sum += j; } else { o0.stop(j); sum += 1000; }  } say("sum", sum); return sum; }
async function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (state.map.get(j) == null) fail0(j); if (!(j > 4)) { sum += j; } else { fail1(j); sum += 1000; } await null; } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { throw new Error("zero"); }, v: 0 }; function fail0(x) { o0.stop(x); }
const fail1 = x => { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } };
const fail2 = x => { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } };
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(state.map.get(j) == null)) { sum += j; } else { o0.stop(j); sum += 1000; } switch (j) { case 1: sum++; break; case 2: fail1(j); default: sum += 2; } switch (j) { case 1: sum++; break; case 2: o0.stop(j); default: sum += 2; } say("v", j, state.map.get(j) == null && fail0(j)); try { switch (j) { case 1: sum++; break; case 2: fail1(j); default: sum += 2; } } finally { say("f", j);  }  } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { const u4879 = list[j] ?? fail1(j); try { sum += list[j] | 0; } finally { say("f", j);  }  } say("sum", sum); return sum; }
function* run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(j > 4)) { sum += j; } else { fail0(j); sum += 1000; } state.n = j; state.k += state.n;  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(2)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { switch (x % 2) { case 0: throw new Error("even"); default: throw new RangeError("odd"); } }
function fail1(x) { throw new Error("f1 " + x); } function assert1(p, x) { if (!p) fail1(x); }
class K2 { constructor(v) { this.v = v; } stop(x) { if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); } get g() { const x = this.v; if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); } } const k2 = new K2(2); function fail2(x) { return k2.stop(x); }
const fail3 = x => { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } };
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (state.map.get(j) == null) assert1(j != 3, 3); say("v", j, j === 3 && fail0(j)); switch (j) { case 1: sum++; break; case 2: k2.stop(j); default: sum += 2; } const u1301 = list[j] ?? (j, k2.g); switch (j) { case 1: sum++; break; case 2: fail1(j); default: sum += 2; }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { if (x === 4) return say("four"); throw new Error("not four"); } function assert0(p, x) { if (!p) fail0(x); }
function fail1(x) { switch (x % 2) { case 0: throw new Error("even"); default: throw new RangeError("odd"); } }
function fail2(x) { try { null.y; } catch (z) { throw new Error("caught " + (z instanceof TypeError)); } }
class K3 { constructor(v) { this.v = v; } stop(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } } get g() { const x = this.v; while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } } } const k3 = new K3(3); function fail3(x) { return k3.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { state.n = j; state.k += state.n; if (state.k > 9) k3.check(j < 2, 7); try { const t1498 = state.map.get(j) == null ? fail2(j) : j; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } try { if (!(typeof list[j] !== "number")) { sum += j; } else { k3.check(j < 2, 7); sum += 1000; } } finally { say("f", j);  }  } say("sum", sum); return sum; }
async function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { const u8416 = list[j] ?? (j, k3.g); say("v", j, !(list[j] >= 0) && k3.stop(j)); try { state.n = j; state.k += state.n; } finally { say("f", j);  } try { say("v", j, !(list[j] >= 0) && fail0(j)); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; } await null; } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } }, v: 0 }; function fail0(x) { o0.stop(x); }
function fail1(x) { try { null.y; } catch (z) { throw new Error("caught " + (z instanceof TypeError)); } }
function fail2(x) { throw new Error("f2 " + x); } function assert2(p, x) { if (!p) fail2(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { const t7186 = j === 3 ? fail2(j) : j; } finally { say("f", j);  } say("v", j, !(list[j] >= 0) && fail0(j)); if (state.k > 9) fail1(j); try { say("v", j, j === 3 && assert2(j != 3, 3)); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } say("v", j, typeof list[j] !== "number" && fail2(j));  } say("sum", sum); return sum; }
function* run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { say("v", j, state.map.get(j) == null && fail0(j)); say("v", j, state.map.get(j) == null && fail2(j)); sum += say(state.k > 9 || 1) ? 1 : 2; state.n = j; state.k += state.n;  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(3)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run1(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { throw new Error("zero"); }
function fail1(x) { try { null.y; } catch (z) { throw new Error("caught " + (z instanceof TypeError)); } } function assert1(p, x) { if (!p) fail1(x); }
const o2 = { stop(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } }, v: 2 }; function fail2(x) { o2.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function* run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(typeof list[j] !== "number")) { sum += j; } else { assert1(j != 3, 3); sum += 1000; } sum += list[j] | 0; switch (j) { case 1: sum++; break; case 2: o2.stop(j); default: sum += 2; } sum += say(!(list[j] >= 0) || 1) ? 1 : 2; yield j; } say("sum", sum); return sum; }
await (async () => {
try { for (const x of run0(2)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const fail0 = x => { try { null.y; } catch (z) { throw new Error("caught " + (z instanceof TypeError)); } };
function fail1(x) { try { throw new Error("a" + x); } finally { state.n++; } } function assert1(p, x) { if (!p) fail1(x); }
const fail2 = x => { throw x; };
class K3 { constructor(v) { this.v = v; } stop(x) { throw new Error("f3 " + x); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { throw new Error("f3 " + x); } get g() { const x = this.v; throw new Error("f3 " + x); } } const k3 = new K3(3); function fail3(x) { return k3.stop(x); }
const o4 = { stop(x) { throw new Error("f4 " + x); }, v: 4 }; function fail4(x) { o4.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { say("v", j, state.map.get(j) == null && k3.stop(j)); state.n = j; state.k += state.n; sum += list[j] | 0;  } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(typeof list[j] !== "number")) { sum += j; } else { fail0(j); sum += 1000; } switch (j) { case 1: sum++; break; case 2: K3.bad(j); default: sum += 2; } switch (j) { case 1: sum++; break; case 2: fail1(j); default: sum += 2; }  } say("sum", sum); return sum; }
function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (j > 6) (j, k3.g); try { sum += list[j] | 0; } finally { say("f", j);  } state.n = j; state.k += state.n; sum += list[j] | 0; try { if (!(list[j] >= 0)) k3.check(j < 2, 7); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const fail0 = x => { if (x === 4) return say("four"); throw new Error("not four"); };
function fail1(x) { if (x === 4) return say("four"); throw new Error("not four"); }
const fail2 = x => { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } };
function fail3(x) { if (x === 4) return say("four"); throw new Error("not four"); } function assert3(p, x) { if (!p) fail3(x); }
function fail4(x) { say("in", x); throw new Error("said"); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { const u8833 = list[j] ?? fail1(j); if (!(!(list[j] >= 0))) { sum += j; } else { fail4(j); sum += 1000; } const t9681 = state.k > 9 ? fail4(j) : j; const t9187 = j > 6 ? fail0(j) : j;  } say("sum", sum); return sum; }
async function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += list[j] | 0; sum += list[j] | 0; await null; } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { try { throw new Error("a" + x); } finally { state.n++; } }, v: 0 }; function fail0(x) { o0.stop(x); }
function fail1(x) { throw x; }
const fail2 = x => { if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); };
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function* run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += say(state.k > 9 || 1) ? 1 : 2; if (!(list[j] >= 0)) fail1(j); state.n = j; state.k += state.n; const t9790 = typeof list[j] !== "number" ? fail1(j) : j; const u76 = list[j] ?? o0.stop(j); yield j; } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += list[j] | 0; switch (j) { case 1: sum++; break; case 2: fail0(j); default: sum += 2; } try { say("v", j, state.k > 9 && fail0(j)); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } say("v", j, state.map.get(j) == null && fail1(j)); try { say("v", j, state.map.get(j) == null && fail1(j)); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; }  } say("sum", sum); return sum; }
async function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { const t4901 = !(list[j] >= 0) ? fail1(j) : j; } finally { say("f", j);  } const u4239 = list[j] ?? fail0(j); const u5683 = list[j] ?? o0.stop(j); state.n = j; state.k += state.n; sum += list[j] | 0;  } say("sum", sum); return sum; }
await (async () => {
try { for (const x of run0(2)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const fail0 = x => { say("in", x); throw new Error("said"); };
class K1 { constructor(v) { this.v = v; } stop(x) { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } get g() { const x = this.v; for (;;) { calls++; if (calls % 3 == 0) throw new Error("looped " + x); } } } const k1 = new K1(1); function fail1(x) { return k1.stop(x); }
function fail2(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } }
function fail3(x) { switch (x % 2) { case 0: throw new Error("even"); default: throw new RangeError("odd"); } }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(list[j] >= 0)) fail0(j); const u2632 = list[j] ?? fail0(j); try { sum += say(j === 3 || 1) ? 1 : 2; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { try { null.y; } catch (z) { throw new Error("caught " + (z instanceof TypeError)); } }, v: 0 }; function fail0(x) { o0.stop(x); }
function fail1(x) { if (x === 4) return say("four"); throw new Error("not four"); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { switch (j) { case 1: sum++; break; case 2: fail1(j); default: sum += 2; } try { state.n = j; state.k += state.n; } finally { say("f", j);  } if (state.k > 9) fail0(j);  } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += list[j] | 0; state.n = j; state.k += state.n; const u1258 = list[j] ?? o0.stop(j); try { const u190 = list[j] ?? o0.stop(j); } finally { say("f", j);  }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } } function assert0(p, x) { if (!p) fail0(x); }
const fail1 = x => { switch (x % 2) { case 0: throw new Error("even"); default: throw new RangeError("odd"); } };
function fail2(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
async function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { const t9575 = typeof list[j] !== "number" ? fail0(j) : j; state.n = j; state.k += state.n; state.n = j; state.k += state.n; try { sum += list[j] | 0; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } sum += say(j > 2 || 1) ? 1 : 2; await null; } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(typeof list[j] !== "number")) { sum += j; } else { fail2(j); sum += 1000; } const t6279 = state.k > 9 ? fail0(j) : j; sum += say(state.map.get(j) == null || 1) ? 1 : 2;  } say("sum", sum); return sum; }
async function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(state.k > 9)) { sum += j; } else { assert0(j != 3, 3); sum += 1000; } switch (j) { case 1: sum++; break; case 2: assert0(j != 3, 3); default: sum += 2; } try { try { say("v", j, typeof list[j] !== "number" && fail0(j)); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } } finally { say("f", j);  }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", await run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { throw x; }, v: 0 }; function fail0(x) { o0.stop(x); }
class K1 { constructor(v) { this.v = v; } stop(x) { throw new Error("f1 " + x); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { throw new Error("f1 " + x); } get g() { const x = this.v; throw new Error("f1 " + x); } } const k1 = new K1(1); function fail1(x) { return k1.stop(x); }
function fail2(x) { throw x; }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { state.n = j; state.k += state.n; say("v", j, !(list[j] >= 0) && fail0(j));  } say("sum", sum); return sum; }
async function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(typeof list[j] !== "number")) { sum += j; } else { fail2(j); sum += 1000; } if (!(typeof list[j] !== "number")) { sum += j; } else { k1.stop(j); sum += 1000; }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const o0 = { stop(x) { throw new Error("zero"); }, v: 0 }; function fail0(x) { o0.stop(x); }
function fail1(x) { fail0(x); } function assert1(p, x) { if (!p) fail1(x); }
const o2 = { stop(x) { while (true) { if (state.n++ > 2) { state.n = 0; throw new Error("while"); } } }, v: 2 }; function fail2(x) { o2.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { const u1708 = list[j] ?? assert1(j != 3, 3); say("v", j, j === 3 && fail1(j)); if (state.k > 9) o2.stop(j); try { const u23 = list[j] ?? fail2(j); } finally { say("f", j); continue; }  } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { sum += say(state.k > 9 || 1) ? 1 : 2; if (state.k > 9) fail0(j);  } say("sum", sum); return sum; }
function* run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { switch (j) { case 1: sum++; break; case 2: o2.stop(j); default: sum += 2; } sum += list[j] | 0; sum += say(typeof list[j] !== "number" || 1) ? 1 : 2; say("v", j, state.k > 9 && fail2(j)); yield j; } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(3)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run2(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { switch (x % 2) { case 0: throw new Error("even"); default: throw new RangeError("odd"); } }
function fail1(x) { if (x === 4) return say("four"); throw new Error("not four"); }
function fail2(x) { throw x; } function assert2(p, x) { if (!p) fail2(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
async function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { state.n = j; state.k += state.n; say("v", j, !(list[j] >= 0) && assert2(j != 3, 3)); try { sum += say(!(list[j] >= 0) || 1) ? 1 : 2; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } sum += say(typeof list[j] !== "number" || 1) ? 1 : 2; if (typeof list[j] !== "number") assert2(j != 3, 3);  } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { if (j > 6) fail1(j); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } try { try { sum += say(typeof list[j] !== "number" || 1) ? 1 : 2; } finally { say("f", j);  } } finally { say("f", j);  } say("v", j, j > 4 && fail0(j)); sum += list[j] | 0; say("v", j, j > 6 && assert2(j != 3, 3));  } say("sum", sum); return sum; }
async function run2(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(typeof list[j] !== "number")) { sum += j; } else { fail0(j); sum += 1000; } say("v", j, j === 3 && fail1(j)); const u3250 = list[j] ?? assert2(j != 3, 3); state.n = j; state.k += state.n; try { sum += say(j === 3 || 1) ? 1 : 2; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; }  } say("sum", sum); return sum; }
await (async () => {
try { say("r", await run0(2)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run2(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { throw new Error("zero"); } function assert0(p, x) { if (!p) fail0(x); }
function fail1(x) { if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function* run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { const t7971 = state.map.get(j) == null ? fail0(j) : j; try { state.n = j; state.k += state.n; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; } say("v", j, state.map.get(j) == null && fail1(j)); say("v", j, state.map.get(j) == null && fail0(j)); const u7076 = list[j] ?? fail0(j); yield j; } say("sum", sum); return sum; }
await (async () => {
try { for (const x of run0(2)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
const fail0 = x => { if (x === 4) return say("four"); throw new Error("not four"); };
function fail1(x) { if (x > 3) throw new Failure("big " + x); throw new TypeError("small " + x); } function assert1(p, x) { if (!p) fail1(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function* run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { say("v", j, j > 6 && fail0(j)); if (j === 3) fail0(j); try { if (typeof list[j] !== "number") fail1(j); } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name);  } yield j; } say("sum", sum); return sum; }
function run1(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(j > 6)) { sum += j; } else { fail1(j); sum += 1000; } state.n = j; state.k += state.n;  } say("sum", sum); return sum; }
await (async () => {
try { for (const x of run0(2)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { for (const x of run0(9)) say("x", x); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run1(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
function fail0(x) { try { throw new Error("a" + x); } finally { state.n++; } }
const o1 = { stop(x) { throw new Error("f1 " + x); }, v: 1 }; function fail1(x) { o1.stop(x); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { try { state.n = j; state.k += state.n; } catch (z) { say("c", z && z.message, z && z.constructor && z.constructor.name); if (j > 4) throw z; } sum += say(j === 3 || 1) ? 1 : 2; state.n = j; state.k += state.n; if (state.k > 9) o1.stop(j); state.n = j; state.k += state.n;  } say("sum", sum); return sum; }
await (async () => {
try { say("r", run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
await (async () => {
const out = []; const say = (...a) => { if (out.length < 400) out.push(a.join(" ")); return a[0]; };
class Failure extends Error {} let calls = 0; const state = { n: 0, k: 1, text: "t", map: new Map([[2, "two"], [5, "five"]]) };
class K0 { constructor(v) { this.v = v; } stop(x) { say("in", x); throw new Error("said"); } check(p, x) { if (!p) this.stop(x); return this.v; } static bad(x) { say("in", x); throw new Error("said"); } get g() { const x = this.v; say("in", x); throw new Error("said"); } } const k0 = new K0(0); function fail0(x) { return k0.stop(x); }
function fail1(x) { say("in", x); throw new Error("said"); }
const list = [4, 1, 7, 2.5, 3, "x", 9, undefined, 6];
async function run0(limit) { let sum = 0; for (let j = 0; j < limit; j++) { if (!(!(list[j] >= 0))) { sum += j; } else { K0.bad(j); sum += 1000; } sum += list[j] | 0; await null; } say("sum", sum); return sum; }
await (async () => {
try { say("r", await run0(3)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
try { say("r", await run0(9)); } catch (z) { say("threw", z && z.message, z && z.constructor && z.constructor.name); }
say(state.n, state.k, calls); console.log(out.join("\n")); })();
})();
