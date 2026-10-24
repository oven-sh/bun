// Generators and async functions are resumed from inside themselves, twice, by foreign callers, after they ended, and while collections run.
const out = [];
function show(f) { try { const v = f(); return typeof v === "object" && v ? JSON.stringify(v) : String(v); } catch (e) { return "threw " + (e && e.constructor ? e.constructor.name : e); } }
let self;
function* reenter(how) { const a = 1.5, b = 7, c = "s", d = { k: 1 }; yield show(() => self[how](1)); try { yield a + b; } finally { out.push("finally " + show(() => self[how](2))); yield c + d.k; } return "end"; }
for (const how of ["next", "return", "throw"]) { self = reenter(how); out.push(how, show(() => self.next()), show(() => self.next()), show(() => self.return(9)), show(() => self.next()), show(() => self.next()), show(() => self.throw(new RangeError("late")))); }
function* numbers(n) { let t = 0.5; for (let i = 0; i < n; i++) { t += i; const got = yield t; if (got === "gc") Bun.gc(true); if (got === "deep") yield* numbers(3); } return t; }
const evaluated = (0, eval)("(function* (n) { let t = 0.5; for (let i = 0; i < n; i++) { t += i; yield t; } return t; })");
const G = Object.getPrototypeOf(numbers).prototype;
const mine = numbers(3), theirs = evaluated(3);
out.push(show(() => G.next.call(theirs)), show(() => G.next.call(mine)), show(() => mine.next.call(theirs, 1)), show(() => theirs.next.call(mine, 1)), show(() => G.next.call({})), show(() => G.next.call(1)), show(() => G.return.call(theirs, 5)), show(() => G.throw.call(mine, 5)), show(() => G.next.call((async function* () {})())),
    show(() => G.next.call(Object.create(mine))), show(() => G.next.call(new Proxy(numbers(1), {}))), show(() => Reflect.apply(G.next, numbers(1), [])), show(() => [...numbers(4)].join()), show(() => [...evaluated(4)].join()));
{ const g = numbers(50); const kept = []; for (let i = 0; i < 40; i++) kept.push(g.next(i % 7 === 0 ? "gc" : i % 11 === 0 ? "deep" : i).value); out.push(kept.join()); }
{ const many = []; for (let i = 0; i < 2000; i++) { const g = numbers(5); g.next(); g.next(); many.push(g); } Bun.gc(true); let t = 0; for (const g of many) t += g.next().value + g.next("gc" === many ? 1 : 0).value; out.push(t); }
function modify(title, change) { const g = numbers(3); g.next(); const did = show(() => change(g)); const seen = []; out.push(title, did, show(() => { for (const v of g) seen.push(v); return seen.join(); }), show(() => g.next())); }
modify("own next", g => { g.next = () => ({ done: true }); });
modify("own iterator", g => { g[Symbol.iterator] = () => [7, 8][Symbol.iterator](); });
modify("null prototype", g => Object.setPrototypeOf(g, null) && 1);
modify("other prototype", g => Object.setPrototypeOf(g, { next() { return { done: true, value: 0 }; }, [Symbol.iterator]() { return this; } }) && 1);
modify("prototype of the function gets next", g => { numbers.prototype.next = function () { return { done: true }; }; });
delete numbers.prototype.next;
modify("prototype of the function gets another parent", g => Object.setPrototypeOf(numbers.prototype, { next() { return { done: true }; }, [Symbol.iterator]() { return this; } }) && 1);
Object.setPrototypeOf(numbers.prototype, G);
modify("frozen", g => Object.isFrozen(Object.freeze(g)));
{ const was = numbers.prototype; numbers.prototype = null; modify("function without a prototype", g => Object.getPrototypeOf(g) === G); numbers.prototype = 5; modify("a number for a prototype", g => Object.getPrototypeOf(g) === G); numbers.prototype = { next() { return { done: true, value: "mine" }; } }; out.push(show(() => numbers(2).next())); numbers.prototype = was; }
function* deep(n) { if (n) yield* deep(n - 1); else yield "bottom"; }
out.push(show(() => [...deep(500)].join()), show(() => { try { return [...deep(3)].length; } catch (e) { return e.constructor.name; } }), show(() => [...deep(3)].join()));
function* overflow() { const f = () => f() + 1; try { f(); } catch (e) { yield e.constructor.name; } yield "after"; }
out.push(show(() => [...overflow()].join()));
function* delegates(it) { try { return yield* it; } catch (e) { return "caught " + e; } }
for (const [t, it] of Object.entries({ noReturn: { [Symbol.iterator]() { return { next() { return { value: 1, done: false }; } }; } }, badResult: { [Symbol.iterator]() { return { next() { return 5; } }; } }, throwsOnReturn: { [Symbol.iterator]() { return { next() { return { value: 1 }; }, return() { throw new Error("r"); } }; } },
    getters: { [Symbol.iterator]() { let n = 0; return { next() { return { get done() { out.push("done?"); return n++ > 1; }, get value() { out.push("value?"); return n; } }; } }; } } })) {
    const g = delegates(it); out.push(t, show(() => g.next()), show(() => g.next(2)), show(() => g.throw("x")), show(() => g.return("y")), show(() => g.next()));
}
const order = [];
const twice = { then(ok, no) { ok(1); ok(2); no(3); order.push("then ran"); } };
const later = { then(ok) { setTimeout(() => { ok("late"); ok("later still"); }, 1); } };
const thrower = { get then() { throw new RangeError("getter"); } };
const afterResolve = { then(ok) { ok("first"); throw new Error("ignored"); } };
const nested = { then(ok) { ok({ then(ok2) { ok2({ then(ok3) { ok3("three deep"); } }); } }); } };
async function waits(x) { const a = 2.5, b = [1]; try { const v = await x; Bun.gc(true); return v + "/" + a + b; } catch (e) { return "caught " + (e && e.message); } finally { order.push("done " + a); } }
async function* stream(n) { for (let i = 0; i < n; i++) { const got = yield i * 1.5; if (got) order.push("got " + got); } return "over"; }
const results = await Promise.all([waits(twice), waits(later), waits(thrower), waits(afterResolve), waits(nested), waits(Promise.reject(new Error("no"))), waits(5), waits(waits(waits(1)))]);
out.push(results.join(" ; "));
{ const s = stream(3); const all = await Promise.all([s.next("a"), s.next("b"), s.return(twice), s.next("c"), s.throw(new Error("t")).catch(e => "rejected " + e.message)]); out.push(JSON.stringify(all)); }
{ const s = stream(3); const A = Object.getPrototypeOf(stream).prototype; out.push(await A.next.call({}).catch(e => e.constructor.name), await A.next.call(numbers(1)).catch(e => e.constructor.name), JSON.stringify(await A.next.call(s)), JSON.stringify(await A.return.call(s, thrower).catch(e => e.message))); }
{ const seen = []; for await (const v of stream(3)) { seen.push(v); Bun.gc(true); } for await (const v of [twice, 2, later]) seen.push(v); out.push(seen.join()); }
{ class Sub extends Promise { static get [Symbol.species]() { return Promise; } then(a, b) { order.push("sub then"); return super.then(a, b); } } out.push(await waits(Sub.resolve("sub"))); const p = Promise.resolve("own then"); p.then = function (ok) { ok("replaced"); }; out.push(await waits(p)); const q = Promise.resolve("ctor"); q.constructor = Object; out.push(await waits(q)); }
console.log(out.join("\n")); console.log(order.join());
