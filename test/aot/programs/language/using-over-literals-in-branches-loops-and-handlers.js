// A resource that is a literal, so that the compiler may leave the allocation out: every way into and out of the block that disposes it.
const log = [];
function note(x) { log.push(x); }
function flush(name) { console.log(name, log.join(" ")); log.length = 0; }
function attempt(name, f, ...args) { try { note("-> " + f(...args)); } catch (e) { note("threw " + (e && e.message || e)); } flush(name); }

function plain(c) { using r = { [Symbol.dispose]() { note("d"); } }; if (c) return "early"; return "late"; }
function twoArms(c) { using r = c ? { n: 1, [Symbol.dispose]() { note("d1"); } } : { m: 2, [Symbol.dispose]() { note("d2"); } }; return c; }
function inLoop(n) { for (let i = 0; i < n; i++) { using r = { i, [Symbol.dispose]() { note("d" + this.i); } }; if (i === 1) continue; if (i === 3) break; note("b" + i); } return n; }
function loopHead(n) { for (using r = { [Symbol.dispose]() { note("dh"); } }; n > 0; n--) note("n" + n); return "done"; }
function nested(c) { using a = { [Symbol.dispose]() { note("da"); } }; { using b = { [Symbol.dispose]() { note("db"); if (c) throw new Error("b"); } }; note("in"); } return "out"; }
function throwsInBody(c) { using r = { v: c, [Symbol.dispose]() { note("d" + this.v); } }; if (c) throw new Error("body"); return r.v; }
function bothThrow() { using r = { [Symbol.dispose]() { throw new Error("dispose"); } }; throw new Error("body"); }
function storedLater(c) { const o = { v: 1, [Symbol.dispose]() { note("d" + this.v); } }; using r = o; o.v = c ? 2 : 3; return o.v; }
function neverUsed(c) { if (c) { using r = { [Symbol.dispose]() { note("d"); } }; } return c; }
function nullish(c) { using r = c ? null : { [Symbol.dispose]() { note("d"); } }; return c; }
function inTry(c) { try { using r = { [Symbol.dispose]() { note("d"); } }; if (c) throw new Error("t"); return "a"; } catch (e) { return "caught " + e.message; } finally { note("f"); } }
function holder(c) { const inner = { x: c }; using r = { inner, [Symbol.dispose]() { note("d" + this.inner.x); } }; inner.x = "changed"; return inner.x; }
function inSwitch(k) { switch (k) { case 0: { using r = { [Symbol.dispose]() { note("d0"); } }; return "zero"; } case 1: { using r = { [Symbol.dispose]() { note("d1"); } }; break; } default: return "other"; } return "after"; }
function* generated(c) { using r = { [Symbol.dispose]() { note("dg"); } }; yield 1; if (c) return 2; yield 3; }
async function awaited(c) { await using r = { async [Symbol.asyncDispose]() { note("ad"); } }; using s = { [Symbol.dispose]() { note("sd"); } }; await null; if (c) throw new Error("async"); return "ok"; }
class Resource { constructor(n) { this.n = n; } [Symbol.dispose]() { note("dc" + this.n); } }
function instances(c) { using a = new Resource(1), b = new Resource(c ? 2 : 3); return a.n + b.n; }
function closure(c) { let seen = 0; using r = { [Symbol.dispose]() { seen++; note("d" + seen); } }; const f = () => seen; return f() + (c ? 1 : 0); }

for (const c of [true, false]) {
  attempt("plain", plain, c); attempt("twoArms", twoArms, c); attempt("nested", nested, c); attempt("throwsInBody", throwsInBody, c);
  attempt("storedLater", storedLater, c); attempt("neverUsed", neverUsed, c); attempt("nullish", nullish, c); attempt("inTry", inTry, c);
  attempt("holder", holder, c); attempt("instances", instances, c); attempt("closure", closure, c);
  attempt("generated", (x) => [...generated(x)].join(), c);
}
attempt("bothThrow", bothThrow);
for (const n of [0, 2, 5]) { attempt("inLoop", inLoop, n); attempt("loopHead", loopHead, n); attempt("inSwitch", inSwitch, n); }
for (const c of [true, false]) await awaited(c).then((v) => note("-> " + v), (e) => note("rejected " + e.message)).then(() => flush("awaited"));
