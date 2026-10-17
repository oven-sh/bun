const H = globalThis; const log = []; let rows = 0;
const kinds = [() => 42, () => "text", () => undefined, () => null, () => ({ an: "object" }), () => new Error("an error"), () => Symbol("s"), () => 10n, () => function thrown() {}, () => [1, 2]];
const told = (what, thrown, caught) => { rows++; console.log(what + ": " + (Object.is(thrown, caught) ? "the same" : "ANOTHER") + " " + typeof caught + " " + Object.prototype.toString.call(caught)); };
function raise(x) { throw x; }
function small(x) { try { raise(x); } finally { H.f = 1; } }
function oneFunction(x) { try { try { throw x; } finally { H.f = 1; } } catch (e) { return e; } }
function calleeThrows(x) { try { try { raise(x); } finally { H.f = 1; } } catch (e) { return e; } }
function threeDeep(x) { try { try { try { try { raise(x); } finally { H.a = 1; } } finally { H.b = 1; } } finally { H.c = 1; } } catch (e) { return e; } }
function apart(x) { try { small(x); } catch (e) { return e; } }
function apartTwice(x) { try { try { small(x); } finally { H.g = 1; } } catch (e) { return e; } }
function catchThenFinally(x) { try { try { raise(x); } catch (e) { throw e; } finally { H.f = 1; } } catch (e) { return e; } }
function bound(x) { let kept; try { try { raise(x); } finally { H.f = 1; } } catch (e) { kept = e; } return kept; }
function closure(x) { let got; const take = e => { got = e; }; try { try { raise(x); } finally { H.f = 1; } } catch (e) { take(e); } return got; }
function destructured(x) { try { try { raise({ x }); } finally { H.f = 1; } } catch ({ x: inner }) { return inner; } }
function noBinding(x) { try { try { raise(x); } finally { H.f = 1; } } catch { return x; } }
function inLoop(x) { for (let i = 0; i < 3; i++) { try { try { if (i === 2) raise(x); } finally { H.i = i; } } catch (e) { return e; } } }
function forOf(x) { try { for (const v of [1, 2, 3]) raise(x); } catch (e) { return e; } }
function forOfOwn(x) { const it = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return() { log.push("closed"); return {}; } }; try { for (const v of it) raise(x); } catch (e) { return e; } }
function forOfLocal(x) { const it = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return() { log.push("closed"); return {}; } }; try { for (const v of it) throw x; } catch (e) { return e; } }
function forOfReturnThrows(x) { const it = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return() { throw "from return()"; } }; try { for (const v of it) raise(x); } catch (e) { return e; } }
function forOfReturnNoObject(x) { const it = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return() { return 1; } }; try { for (const v of it) raise(x); } catch (e) { return e; } }
function forOfSet(x) { try { for (const v of new Set([1])) raise(x); } catch (e) { return e; } }
function forOfGenerator(x) { function* g() { try { yield 1; } finally { log.push("generator closed"); } } try { for (const v of g()) raise(x); } catch (e) { return e; } }
function pattern(x) { const it = { [Symbol.iterator]() { return this; }, next() { return { done: false, value: 1 }; }, return() { log.push("pattern closed"); return {}; } }; try { const [a = raise(x)] = { [Symbol.iterator]() { return { next() { return { done: false, value: undefined }; }, return() { log.push("pattern closed"); return {}; } }; } }; } catch (e) { return e; } }
function patternTarget(x) { const o = { set p(v) { raise(x); } }; try { [o.p] = { [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { log.push("target closed"); return {}; } }; } }; } catch (e) { return e; } }
for (const f of [oneFunction, calleeThrows, threeDeep, apart, apartTwice, catchThenFinally, bound, closure, destructured, noBinding, inLoop, forOf, forOfOwn, forOfLocal, forOfReturnThrows, forOfReturnNoObject, forOfSet, forOfGenerator, pattern, patternTarget]) for (const make of kinds) { const x = make(); told(f.name, x, f(x)); }
console.log("closings: " + log.length + " " + [...new Set(log)].join()); log.length = 0;
const say = (what, v) => { rows++; console.log(what + ": " + (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))); };
function finallyReturns() { try { raise("lost"); } finally { return "the finally's"; } } say("a finally that returns", finallyReturns());
function finallyBreaks() { for (;;) { try { raise("lost"); } finally { break; } } return "went on"; } say("a finally that breaks", finallyBreaks());
function finallyContinues() { let n = 0; for (let i = 0; i < 3; i++) { try { raise("lost"); } finally { n++; continue; } } return n; } say("a finally that continues", finallyContinues());
function finallyThrows() { try { try { raise("the first"); } finally { raise("the finally's own"); } } catch (e) { return e; } } say("a finally that throws", finallyThrows());
function finallyThrowsLocally() { try { try { throw "the first"; } finally { throw "the finally's own"; } } catch (e) { return e; } } say("a finally that throws, all in one function", finallyThrowsLocally());
function finallyCatchesWithin() { try { try { raise("the outer one"); } finally { try { raise("within"); } catch (e) { H.w = e; } } } catch (e) { return e + " | " + H.w; } } say("a finally that throws and catches within", finallyCatchesWithin());
function returnThenFinally() { try { return "returned"; } finally { H.f = 2; } } say("a return through a finally", returnThenFinally());
function returnOrThrow(t) { try { if (t) raise("thrown"); return "returned"; } finally { H.f = 3; } } say("one finally for both", returnOrThrow(false) + " | " + (() => { try { returnOrThrow(true); } catch (e) { return e; } })());
function labelled() { a: try { try { raise("x"); } finally { break a; } } finally { H.f = 4; } return "left by the label"; } say("a labelled break out of a finally", labelled());
function order() { const o = []; try { try { try { raise("t"); } finally { o.push(1); } } finally { o.push(2); } } catch (e) { o.push(e); } finally { o.push(3); } return o; } say("the order", order());
function* gen(x) { try { yield 1; yield 2; } finally { log.push("gen finally"); yield "from the finally"; } }
{ const g = gen(); g.next(); say("generator.throw through a finally that yields", [g.throw("injected"), (() => { try { return g.next(); } catch (e) { return "threw " + e; } })()]); }
{ const g = gen(); g.next(); say("generator.return through a finally that yields", [g.return("given"), g.next(), g.next()]); }
function* genThrows(x) { try { raise(x); } finally { yield "suspended with it"; } }
for (const make of kinds) { const x = make(); const g = genThrows(x); g.next(); let c; try { g.next(); } catch (e) { c = e; } told("across a yield", x, c); }
function* delegating(x) { try { yield* genThrows(x); } finally { H.d = 1; } }
for (const make of kinds.slice(0, 5)) { const x = make(); const g = delegating(x); g.next(); let c; try { g.next(); } catch (e) { c = e; } told("across yield*", x, c); }
async function asyncFinally(x) { try { raise(x); } finally { await null; H.f = 5; } }
async function asyncNested(x) { try { try { await Promise.reject(x); } finally { await null; } } catch (e) { return e; } }
async function asyncForAwait(x) { const it = { [Symbol.asyncIterator]() { return this; }, async next() { return { done: false, value: 1 }; }, async return() { log.push("async closed"); return {}; } }; try { for await (const v of it) raise(x); } catch (e) { return e; } }
async function* asyncGenerator(x) { try { yield 1; raise(x); } finally { await null; } }
const collect = () => { if (typeof fullGC === "function") { fullGC(); edenGC(); } else Bun.gc(true); };
const fresh = [() => ({ fresh: "object" }), () => new Error("fresh"), () => [1, 2, 3], () => Symbol("fresh"), () => "fresh " + rows];
async function parked(make, seen) { try { const x = make(); seen.push(typeof x === "object" ? new WeakRef(x) : x); raise(x); } finally { await H.gate; H.f = 6; } }
async function parkedTwice(make, seen) { try { try { const x = make(); seen.push(typeof x === "object" ? new WeakRef(x) : x); raise(x); } finally { await H.gate; } } finally { await H.gate2; } }
async function parkedUsing(make, seen) { await using r = { async [Symbol.asyncDispose]() { await H.gate; } }; const x = make(); seen.push(typeof x === "object" ? new WeakRef(x) : x); raise(x); }
function usingOne(x) { try { using r = { [Symbol.dispose]() { log.push("disposed"); } }; raise(x); } catch (e) { return e; } }
function usingTwo(x) { try { using r = { [Symbol.dispose]() { log.push("disposed 1"); } }, q = { [Symbol.dispose]() { log.push("disposed 2"); } }; raise(x); } catch (e) { return e; } }
function usingLocal(x) { try { using r = { [Symbol.dispose]() {} }; throw x; } catch (e) { return e; } }
function usingApartInner(x) { using r = { [Symbol.dispose]() {} }; raise(x); } function usingApart(x) { try { usingApartInner(x); } catch (e) { return e; } }
function usingSuppressed(x) { try { using r = { [Symbol.dispose]() { throw "the disposer's"; } }; raise(x); } catch (e) { return e instanceof SuppressedError && e.error === "the disposer's" ? e.suppressed : "NO SuppressedError"; } }
function usingInFinally(x) { try { try { using r = { [Symbol.dispose]() {} }; raise(x); } finally { H.f = 7; } } catch (e) { return e; } }
function usingInLoopHead(x) { try { for (using r of [{ [Symbol.dispose]() {} }]) raise(x); } catch (e) { return e; } }
for (const f of [usingOne, usingTwo, usingLocal, usingApart, usingSuppressed, usingInFinally, usingInLoopHead]) for (const make of kinds) { const x = make(); told(f.name, x, f(x)); }
(async () => {
    for (const make of kinds) { const x = make(); let c; try { await asyncFinally(x); } catch (e) { c = e; } told("across an await, rejected", x, c); told("across an await, by then", x, await asyncFinally(x).then(() => "fulfilled", e => e)); told("across an await, caught within", x, await asyncNested(x)); told("for await", x, await asyncForAwait(x)); const g = asyncGenerator(x); await g.next(); let d; try { await g.next(); } catch (e) { d = e; } told("an async generator", x, d); }
    for (const f of [parked, parkedTwice, parkedUsing]) for (const make of fresh) { let open, open2; H.gate = new Promise(r => { open = r; }); H.gate2 = new Promise(r => { open2 = r; }); const seen = []; const p = f(make, seen).then(() => "fulfilled", e => e); await null; await null; collect(); collect(); open(); await null; await null; await null; collect(); open2(); const c = await p; const x = seen[0] instanceof WeakRef ? seen[0].deref() : seen[0]; told(f.name + ", collections while parked", x, c); }
    console.log("rows " + rows); console.log("done");
})();
