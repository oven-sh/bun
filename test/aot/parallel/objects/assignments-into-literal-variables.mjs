// Object.assign into a variable of a literal: literals are stores by name, and another object's fields are copied by name.
// STATISTIC: ObjectAssignCallsExpanded >= 9
const N = JSON.parse("40");
const out = [];
const say = (name, ...all) => { if (out.length < 400) out.push(name + " " + all.map(v => typeof v === "object" && v ? JSON.stringify(v) : String(v)).join(" ")); };
const given = JSON.parse("[1,2,3]");
function place(n, o) { const t = { a: n, b: n + 1 }; Object.assign(t, { a: n * 10 }, o); return t.a + t.b; }
function either(n, o) { const t = { a: n, b: n + 1 }; Object.assign(t, { a: n * 10 }, o); return t.a + t.b; }
function between(n, o, p) { const t = { a: n, b: n + 1 }; Object.assign(t, o, { b: n * 100 }, p); return [t.a, t.b, Object.keys(t).join()]; }
function late(n, o) { const t = { a: n }; Object.assign(t, { c: n * 2 }, o); return JSON.stringify(t); }
function stored(n, o) { const t = { a: n, b: 1 }; t.a = n + 5; Object.assign(t, { b: n }, o); t.b++; return JSON.stringify(t); }
function answer(n, o) { const t = { a: n, b: 1 }; const r = Object.assign(t, { b: 2 * n }, o); return (r === t) + JSON.stringify(r); }
function changing(n, o) { let t = { a: n, b: 1 }; Object.assign(t, { b: n }, o); t = { a: 3, b: 4, c: t.b }; Object.assign(t, { c: 1 }, o); return JSON.stringify(t); }
function kept(n, o) { const t = { a: n, b: 1 }; const read = () => t.a + t.b; Object.assign(t, { b: n * 3 }, o); return read(); }
function looped(n, o) { const t = { a: 0, b: 0 }; for (let i = 0; i < 3; i++) Object.assign(t, { a: t.a + n }, o); return t.a * 1000 + t.b; }
function order(n) { const log = []; const t = { a: 1, b: 2 }; Object.assign(t, { a: (log.push("a"), n) }, (log.push("o"), { get b() { log.push("get b"); return t.a; } }), { a: (log.push("a2"), 9) }); return log.join() + JSON.stringify(t); }
function setter(n, o) { const log = []; const t = { a: 1, set b(v) { log.push("set " + v); }, get b() { return log.length; } }; Object.assign(t, { b: n }, o); return log.join() + JSON.stringify(t); }
function frozen(n, o) { const t = Object.freeze({ a: 1, b: 2 }); try { Object.assign(t, { a: n }, o); } catch (error) { return error.constructor.name + JSON.stringify(t); } return "none"; }
function sealed(n, o) { const t = { a: 1, b: 2 }; Object.preventExtensions(t); try { Object.assign(t, { a: n }, o, { z: 1 }); } catch (error) { return error.constructor.name + JSON.stringify(t); } return JSON.stringify(t); }
function itself(n) { const t = { a: n, b: 1 }; Object.assign(t, { a: n * 7 }, t, { b: t.a }); return JSON.stringify(t); }
function empty(n, o) { const t = { a: n, b: 2 }; Object.assign(t, { a: n + 1 }, n & 1 ? o : null); return JSON.stringify(t); }
function undefinedSource(n) { const t = { a: n, b: 2 }; Object.assign(t, { a: n + 1 }, undefined, null, 5, true, "xy"); return JSON.stringify(t); }
function dead(n) { try { return inner(); } catch (error) { return error.constructor.name; } function inner() { Object.assign(t, { a: n }, { b: 1 }); const t = { a: 1 }; return t; } }
function switched(n, o) { switch (n) { case 1: const t = { a: 1, b: 2 }; Object.assign(t, { a: n }, o); return JSON.stringify(t); case 2: try { Object.assign(t, { a: n }, o); } catch (error) { return error.constructor.name; } } return "other"; }
function destructured(o) { const { t } = { t: 5 }; const r = Object.assign(t, { a: 1 }, o); return typeof r + r.a + r.b; }
function declared(o) { try { var t; Object.assign(t, { a: 1 }, o); t = { a: 2 }; } catch (error) { return error.constructor.name; } return "none"; }
const state = { a: 0, b: 0 };
function outside(n, o) { Object.assign(state, { a: n }, o); return state.a + state.b; }
const p = { b: 4 }, q = { b: 5 };
for (let i = 0; i < N; i++) {
  const n = given[i % 3];
  say("place", place(n, { b: i & 7 }));
  say("either", either(n, i & 1 ? p : q));
  say("between", between(n, { a: i }, { b: i & 3 }));
  say("late", late(n, { d: i }));
  say("stored", stored(n, { a: i }));
  say("answer", answer(n, { a: i }));
  say("changing", changing(n, { b: i }));
  say("kept", kept(n, { a: i }));
  say("looped", looped(n, { b: i }));
}
for (let i = 0; i < 4; i++) say("rest", order(i), setter(i, { b: 8 }), frozen(i, { b: 1 }), sealed(i, { b: 5 }), itself(i), empty(i, { b: 6 }), undefinedSource(i), dead(i), switched(i, { b: 3 }), destructured({ b: 2 }), declared({ b: 2 }), outside(i, { b: i }));
say("many", place(2, { b: "t" }), place(1, { a: 1, b: 2, c: 3 }), place(3, Object.create({ b: 9 })), place(1, [7, 8]), place(1, null), place(2, "text"), either(1, new Proxy({ b: 2 }, {})), late(1, { 5: 1, c: 2 }), stored(1, Object.freeze({ b: 2.5 })));
console.log(out.join("\n"));
