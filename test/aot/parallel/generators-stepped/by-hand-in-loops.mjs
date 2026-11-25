const out = [];
const show = v => typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "function" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : v instanceof Error ? v.name + ":" + v.message : v !== null && typeof v === "object" ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : Object.is(v, -0) ? "-0" : String(v);
const log = (...vs) => out.push(vs.map(show).join(" "));
const list = JSON.parse('[3,1.5,"x",null,-2,true]');
function* range(a, b) { for (let k = a; k < b; k++) { const got = yield k; if (got !== undefined) log("got", got); } return "end"; }
function* guarded() { try { while (true) yield "in"; } finally { log("finally"); } }
function* throws(a) { if (a === 2) throw new RangeError("first"); yield a; throw new TypeError("later"); }
function* nested() { const answer = yield* range(0, 2); yield answer; }
let running = null;
function* again() { try { running.next(); } catch (error) { yield error; } }
class Bag { *items() { yield this; yield 2; } }
const shared = range(0, 40), kept = [];
function attempt(f) { try { return f(); } catch (error) { return error; } }
function step(it, v) { const r = it.next(v); return r.done ? "done" : r.value; }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    { const it = range(0, 3); let r = it.next(), t = ""; while (!r.done) { t += r.value; r = it.next(i === 2 ? x : undefined); } log(t, r, it.next()); }
    { const it = range(i, i + 2); const r = it.next(); r.value = x; r.extra = 1; log(r, it.next(), Object.keys(it.next()), Object.getPrototypeOf(it.next()) === Object.prototype); }
    { const it = range(0, 2); kept.push(it.next(), it.next()); const { value, done } = it.next(); log(value, done, { ...it.next() }, "value" in it.next()); }
    { const it = guarded(); it.next(); log(i & 1 ? it.return(x) : attempt(() => it.throw(new Error("in"))), it.next()); }
    { const it = throws(i); log(attempt(() => it.next()), attempt(() => it.next(x)), it.next()); }
    { const it = nested(); for (let r = it.next(); !r.done; r = it.next()) log(r.value); }
    { const it = running = again(); log(it.next(), it.next()); }
    { const it = new Bag().items(); log(it.next().value instanceof Bag, it.next().value, it.next().done); }
    { const it = range(0, 2); if (i === 3) it.next = () => ({ value: "own", done: false }); if (i === 4) Object.setPrototypeOf(it, { next() { return "proto"; } }); if (i === 5) Object.defineProperty(it, "next", { get() { log("get"); return () => 5; } }); log(it.next(), it.next(x)); }
    { const it = range(0, 2); const next = it.next; log(attempt(() => next(x)), next.call(it), it["next"](), step(it, x), step(it)); }
    { const its = [range(0, 3), range(5, 8)]; for (let k = 0; k < 4; k++) log(its[k & 1].next().value); }
    log(shared.next().value, shared.next(x).value, step(shared, i));
  }
}
let r = shared.next(), n = 0;
while (!r.done) { n++; r = shared.next(); }
log(n, r, kept);
console.log(out.join("\n"));
