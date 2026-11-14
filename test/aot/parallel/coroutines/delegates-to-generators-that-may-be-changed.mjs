// yield* over generators as they were made, changed ones, and what is no generator.
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd[Symbol.iterator] = function () { say("own iterator"); return [8][Symbol.iterator](); };
const changed = (() => { function* h() { yield "h"; return "hr"; } Object.defineProperty(h.prototype, "next", { get() { say("get next"); return Object.getPrototypeOf(Object.getPrototypeOf(h.prototype)).next; } }); return h(); })();
function* run() { try { for (let j = 0; j < 3; j++) { say("got", yield* done); say("got", yield* g0(1)); } } finally { say("fin"); } return "end"; }
try { const it = run(); it.next(); say(JSON.stringify(it.return("q"))); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.message); }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.x = 1;
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); }; return h(); })();
function* run() { try { for (let j = 0; j < 2; j++) { say("got", yield* gen.m(2)); say("y", yield "own"); say("got", yield* g2(5)); say("y", yield "own"); } } catch (x) { say("caught", x && x.message); yield 0; } return "end"; }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd[Symbol.iterator] = function () { say("own iterator"); return [8][Symbol.iterator](); };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype = null; return h(); })();
const tbl = {}; tbl.run = function* () { for (let j = 0; j < 2; j++) { if (j == 1) continue; say("got", yield* { [Symbol.iterator]() { say("open"); let i = 0; return { next(v) { say("next", v); return { done: ++i > 2, value: i }; }, return(v) { say("ret", v); return { done: true, value: v }; } }; } }); } return "end"; }; const run = () => tbl.run();
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.return = function (v) { say("own return"); return { done: true, value: v }; };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); }; return h(); })();
function* run() { try { for (let j = 0; j < 3; j++) { say("got", yield* odd); say("y", yield "own"); say("got", yield* gen.m(2)); say("got", yield* [1, 2]); } } finally { say("fin"); } return "end"; }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; } say(JSON.stringify(it.throw(new Error("in")))); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.setPrototypeOf(odd, { __proto__: Object.getPrototypeOf(g0(1)), extra: 1 });
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; }; return h(); })();
function* run() { try { for (let j = 0; j < 3; j++) { if (j == 1) continue; say("got", yield* { [Symbol.iterator]() { say("open"); let i = 0; return { next(v) { say("next", v); return { done: ++i > 2, value: i }; }, return(v) { say("ret", v); return { done: true, value: v }; } }; } }); say("y", yield "own"); say("got", yield* odd); say("y", yield "own"); say("got", yield* done); say("y", yield "own"); } } finally { say("fin"); } return "end"; }
try { const it = run(); it.next(); say(JSON.stringify(it.return("q"))); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.message); }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.return = function (v) { say("own return"); return { done: true, value: v }; };
const changed = (() => { function* h() { yield "h"; return "hr"; }  return h(); })();
const tbl = {}; tbl.run = function* () { try { for (let j = 0; j < 2; j++) { say("got", yield* odd); say("got", yield* g2(5)); } } catch (x) { say("caught", x && x.message); yield 0; } return "end"; }; const run = () => tbl.run();
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.return = function (v) { say("own return"); return { done: true, value: v }; };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; }; return h(); })();
function* run() { say("got", yield* done); say("y", yield "own"); say("got", yield* [1, 2]); say("got", yield* gen); return "end"; }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.next = function (v) { say("own next", v); return { done: true, value: "own" }; };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype = null; return h(); })();
function* run() { for (let j = 0; j < 2; j++) { say("got", yield* Gen.s()); say("got", yield* gen); say("y", yield "own"); say("got", yield* Gen.s()); } return "end"; }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 20) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.next = function (v) { say("own next", v); return { done: true, value: "own" }; };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); }; return h(); })();
function* run() { try { for (let j = 0; j < 3; j++) { say("got", yield* changed); say("y", yield "own"); } } finally { say("fin"); } return "end"; }
try { const it = run(); it.next(); say(JSON.stringify(it.return("q"))); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.message); }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.setPrototypeOf(odd, { __proto__: Object.getPrototypeOf(g0(1)), extra: 1 });
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; }; return h(); })();
const tbl = {}; tbl.run = function* () { try { for (let j = 0; j < 2; j++) { say("got", yield* g1(3)); } } finally { say("fin"); } return "end"; }; const run = () => tbl.run();
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; }  } catch (x) { say("threw", x && x.message); }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; } say(JSON.stringify(it.throw(new Error("in")))); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.freeze(odd);
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; }; return h(); })();
const tbl = {}; tbl.run = function* () { try { for (let j = 0; j < 2; j++) { say("got", yield* { [Symbol.iterator]() { say("open"); let i = 0; return { next(v) { say("next", v); return { done: ++i > 2, value: i }; }, return(v) { say("ret", v); return { done: true, value: v }; } }; } }); say("y", yield "own"); say("got", yield* lib.b(2)); } } finally { say("fin"); } return "end"; }; const run = () => tbl.run();
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd[Symbol.iterator] = function () { say("own iterator"); return [8][Symbol.iterator](); };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.extra = 1; return h(); })();
function* run() { say("got", yield* none(7)); say("y", yield "own"); say("got", yield* lib[["a", "b", "c", "d"][at++ % 4]](3)); return "end"; }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd[Symbol.iterator] = function () { say("own iterator"); return [8][Symbol.iterator](); };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); }; return h(); })();
const tbl = {}; tbl.run = function* () { try { for (let j = 0; j < 2; j++) { say("got", yield* g2(5)); say("got", yield* done); say("y", yield "own"); say("got", yield* g1(3)); say("y", yield "own"); } } catch (x) { say("caught", x && x.message); yield 0; } return "end"; }; const run = () => tbl.run();
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.setPrototypeOf(odd, { __proto__: Object.getPrototypeOf(g0(1)), extra: 1 });
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); }; return h(); })();
const o = { *run() { say("got", yield* none(7)); say("y", yield "own"); say("got", yield* gen.m(2)); return "end"; } }; const run = () => o.run();
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.next = function (v) { say("own next", v); return { done: true, value: "own" }; };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.extra = 1; return h(); })();
function* run() { for (let j = 0; j < 2; j++) { say("got", yield* none(7)); say("got", yield* g0(1)); say("y", yield "own"); } return "end"; }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.x = 1;
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.extra = 1; return h(); })();
const o = { *run() { try { for (let j = 0; j < 2; j++) { say("got", yield* lib.b(2)); say("y", yield "own"); } } finally { say("fin"); } return "end"; } }; const run = () => o.run();
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 20) break; } say(JSON.stringify(it.throw(new Error("in")))); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.setPrototypeOf(odd, { __proto__: Object.getPrototypeOf(g0(1)), extra: 1 });
const changed = (() => { function* h() { yield "h"; return "hr"; } Object.defineProperty(h.prototype, "next", { get() { say("get next"); return Object.getPrototypeOf(Object.getPrototypeOf(h.prototype)).next; } }); return h(); })();
function* run() { try { for (let j = 0; j < 2; j++) { say("got", yield* Gen.s()); say("got", yield* odd); } } finally { say("fin"); } return "end"; }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; }  } catch (x) { say("threw", x && x.message); }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.freeze(odd);
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; }; return h(); })();
const o = { *run() { try { for (let j = 0; j < 2; j++) { say("got", yield* g0(1)); say("got", yield* "ab"); say("y", yield "own"); say("got", yield* g2(5)); } } catch (x) { say("caught", x && x.message); yield 0; } return "end"; } }; const run = () => o.run();
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.return = function (v) { say("own return"); return { done: true, value: v }; };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; }; return h(); })();
function* run() { for (let j = 0; j < 3; j++) { say("got", yield* done); say("got", yield* g1(3)); say("y", yield "own"); say("got", yield* g2(5)); } return "end"; }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.setPrototypeOf(odd, { __proto__: Object.getPrototypeOf(g0(1)), extra: 1 });
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype = null; return h(); })();
function* run() { try { for (let j = 0; j < 3; j++) { say("got", yield* none(7)); } } finally { say("fin"); } return "end"; }
try { const it = run(); it.next(); say(JSON.stringify(it.return("q"))); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.message); }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.x = 1;
const changed = (() => { function* h() { yield "h"; return "hr"; } Object.defineProperty(h.prototype, "next", { get() { say("get next"); return Object.getPrototypeOf(Object.getPrototypeOf(h.prototype)).next; } }); return h(); })();
const o = { *run() { try { for (let j = 0; j < 2; j++) { say("got", yield* gen); } } catch (x) { say("caught", x && x.message); yield 0; } return "end"; } }; const run = () => o.run();
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 1) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.message); }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 20) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.x = 1;
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype[Symbol.iterator] = function () { say("proto iterator"); return [9].values(); }; return h(); })();
function* run() { try { say("got", yield* { [Symbol.iterator]() { say("open"); let i = 0; return { next(v) { say("next", v); return { done: ++i > 2, value: i }; }, return(v) { say("ret", v); return { done: true, value: v }; } }; } }); } catch (x) { say("caught", x && x.message); yield 0; } return "end"; }
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.x = 1;
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype = null; return h(); })();
function* run() { say("got", yield* g0(1)); return "end"; }
try { const it = run(); let k = 0; for (;;) { const s = it.next(k); say("step", s.value, s.done); if (s.done || ++k > 3) break; } say(JSON.stringify(it.return(5))); } catch (x) { say("threw", x && x.message); }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.freeze(odd);
const changed = (() => { function* h() { yield "h"; return "hr"; }  return h(); })();
const o = { *run() { for (let j = 0; j < 3; j++) { say("got", yield* none(7)); say("y", yield "own"); say("got", yield* changed); say("y", yield "own"); } return "end"; } }; const run = () => o.run();
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd[Symbol.iterator] = function () { say("own iterator"); return [8][Symbol.iterator](); };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype.next = function () { say("proto next"); return { done: true, value: 1 }; }; return h(); })();
const o = { *run() { say("got", yield* g2(5)); say("y", yield "own"); return "end"; } }; const run = () => o.run();
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.x = 1;
const changed = (() => { function* h() { yield "h"; return "hr"; } Object.defineProperty(h.prototype, "next", { get() { say("get next"); return Object.getPrototypeOf(Object.getPrototypeOf(h.prototype)).next; } }); return h(); })();
const o = { *run() { say("got", yield* g1(3)); say("got", yield* gen); say("y", yield "own"); say("got", yield* [1, 2]); say("y", yield "own"); return "end"; } }; const run = () => o.run();
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.x = 1;
const changed = (() => { function* h() { yield "h"; return "hr"; }  return h(); })();
const o = { *run() { try { for (let j = 0; j < 2; j++) { say("got", yield* { [Symbol.iterator]() { say("open"); let i = 0; return { next(v) { say("next", v); return { done: ++i > 2, value: i }; }, return(v) { say("ret", v); return { done: true, value: v }; } }; } }); } } finally { say("fin"); } return "end"; } }; const run = () => o.run();
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd[Symbol.iterator] = function () { say("own iterator"); return [8][Symbol.iterator](); };
const changed = (() => { function* h() { yield "h"; return "hr"; } h.prototype = null; return h(); })();
const tbl = {}; tbl.run = function* () { for (let j = 0; j < 2; j++) { if (j == 1) continue; say("got", yield* gen.m(2)); } return "end"; }; const run = () => tbl.run();
try { const it = run(); it.next(); say(JSON.stringify(it.return("q"))); say(JSON.stringify(it.next())); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); Object.setPrototypeOf(odd, { __proto__: Object.getPrototypeOf(g0(1)), extra: 1 });
const changed = (() => { function* h() { yield "h"; return "hr"; } Object.defineProperty(h.prototype, "next", { get() { say("get next"); return Object.getPrototypeOf(Object.getPrototypeOf(h.prototype)).next; } }); return h(); })();
const tbl = {}; tbl.run = function* () { try { for (let j = 0; j < 3; j++) { if (j == 1) continue; say("got", yield* g0(1)); say("y", yield "own"); say("got", yield* none(7)); say("y", yield "own"); say("got", yield* done); } } catch (x) { say("caught", x && x.message); yield 0; } return "end"; }; const run = () => tbl.run();
try { for (const x of run()) { say("x", x); if (out.length > 200) break; } } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
(() => {
const out = []; const say = (...a) => out.push(a.join(" "));
function* g0(k) { const s = yield k; say("g0 sent", s); return "r" + k; } function* g1(n) { try { for (let i = 0; i < n; i++) say("g1", yield i * 2); } finally { say("g1 end"); } return n; } function* none(x) { say("none", x); return x; } function* g2(x) { yield* g0(x); return yield* g1(2); }
class Gen { *m(x) { yield this.v; return x; } constructor() { this.v = 3; } static *s() { yield "s"; } *[Symbol.iterator]() { yield "it"; yield* none(1); } } const gen = new Gen();
const lib = { a: g0, b: g1, c: none, d: gen.m };
let at = 0; const done = g0(1); done.next(); done.next();
const odd = g1(2); odd.return = function (v) { say("own return"); return { done: true, value: v }; };
const changed = (() => { function* h() { yield "h"; return "hr"; }  return h(); })();
function* run() { try { for (let j = 0; j < 2; j++) { if (j == 1) continue; say("got", yield* g2(5)); } } finally { say("fin"); } return "end"; }
try { say([...run()].join()); } catch (x) { say("threw", x && x.message); }
console.log(out.slice(0, 500).join("\n"));
})();
