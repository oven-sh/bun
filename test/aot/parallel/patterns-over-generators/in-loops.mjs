const out = [];
const show = v => typeof v === "string" ? JSON.stringify(v) : typeof v === "function" ? "function" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : v instanceof Error ? v.name + ":" + v.message : v !== null && typeof v === "object" ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])).join() + "}" : Object.is(v, -0) ? "-0" : String(v);
const log = (...vs) => out.push(vs.map(show).join(" "));
const list = JSON.parse('[3,1.5,"x",null,-2,true]');
let closed = 0;
function* range(a, b) { try { for (let k = a; k < b; k++) yield k; } finally { closed++; } }
function* short() { yield "one"; }
function* none() {}
function* throws(at) { for (let k = 0; ; k++) { if (k === at) throw new RangeError("at " + k); yield k; } }
function* stays() { try { yield 1; yield 2; } finally { yield "held"; log("left"); } }
function* refuses() { try { yield 1; yield 2; } finally { throw new TypeError("close"); } }
let running = null;
function* again() { try { const [a] = running; yield a; } catch (error) { yield error; } yield "then"; }
let defaults = 0;
const other = () => "default" + defaults++;
function pair([a, b]) { return [b, a]; }
function attempt(f) { try { return f(); } catch (error) { return error; } }
for (let round = 0; round < 2; round++) {
  for (let i = 0; i < list.length; i++) {
    const x = list[i];
    { const [a, b] = range(0, 5); log(a, b, closed); }
    { const [a, b, c] = range(i, i + 2); log(a, b, c, closed); }
    { const [a, b] = short(); log(a, b); }
    { const [a] = none(); log(a); }
    { const [, , c] = range(0, 9); log(c, closed); }
    { const [a, b = other()] = short(); log(a, b); }
    { let a, b; [a, b] = range(1, 4); [b, a] = [a, b]; log(a, b); }
    { const o = {}; [o.a, o["b"]] = range(2, 9); log(o); }
    { const it = range(0, 9); const [a] = it; const [b, c] = it; log(a, b, c, it.next(), closed); }
    { const it = range(0, 9); it.next(); const [a, b] = it; log(a, b); }
    log(attempt(() => { const [a, b] = throws(i); return [a, b]; }));
    { const it = stays(); const [a] = it; log(a, it.next(), it.next()); }
    log(attempt(() => { const [a] = refuses(); return a; }), attempt(() => { const [a, b, c] = refuses(); return c; }));
    { const it = running = again(); const [a, b] = it; log(a, b); }
    { const it = range(0, 9); if (i === 0) it.next = () => ({ value: "own", done: false }); if (i === 1) it.return = () => { log("own return"); return {}; }; if (i === 2) it.return = () => 5; if (i === 3) it.return = undefined; if (i === 4) it[Symbol.iterator] = () => [7, 8][Symbol.iterator](); if (i === 5) Object.setPrototypeOf(it, { next() { return { done: true }; }, [Symbol.iterator]() { return this; } }); log(attempt(() => { const [a, b] = it; return [a, b]; })); }
    log(pair(range(3, 9)), (([a, b]) => a + b)(range(4, 6)));
    for (const [a, b] of [range(0, 2), short()]) log(a, b);
    { const [a, ...b] = range(0, 4); log(a, b); }
    { const [a, [b, c]] = (function* () { yield x; yield range(0, 2); })(); log(a, b, c); }
  }
}
log(closed);
console.log(out.join("\n"));
