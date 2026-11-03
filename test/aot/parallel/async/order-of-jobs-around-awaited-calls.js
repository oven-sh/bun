// Async functions await each other's calls directly, in lists and through thenables. The order in which everything runs is written down.
import { AsyncLocalStorage } from "node:async_hooks";
const log = [];
const mark = t => { log.push(t); };
const ticks = (name, n) => { let p = Promise.resolve(); for (let i = 0; i < n; i++) p = p.then(() => mark(name + i)); };
const kinds = {
    value: () => 1, undefinedValue: () => undefined, promise: () => Promise.resolve("p"), rejected: () => Promise.reject(new Error("r")), pending: () => new Promise(r => setTimeout(() => r("t"), 1)),
    thenable: () => ({ then(ok) { mark("then called"); ok("th"); } }), slowThenable: () => ({ then(ok) { queueMicrotask(() => ok("slow")); } }), throwingThenable: () => ({ then() { throw new Error("tt"); } }), getterThenable: () => ({ get then() { mark("then read"); return undefined; } }),
    nonCallableThen: () => ({ then: 5 }), fn: () => function then() {}, subclass: () => (class P extends Promise {}).resolve("sub"), ownThen: () => { const p = Promise.resolve("o"); p.then = function (a, b) { mark("own then"); return Promise.prototype.then.call(this, a, b); }; return p; },
    otherConstructor: () => { const p = Promise.resolve("c"); p.constructor = function () {}; return p; }, asyncCall: () => leaf("inner"), self: () => null,
};
async function leaf(v) { mark("leaf " + v); return v; }
async function leafAwaits(v) { mark("leafAwaits in " + v); await null; mark("leafAwaits out " + v); return v; }
async function leafThrows(v) { mark("leafThrows " + v); throw new Error("thrown " + v); }
async function leafThrowsLate(v) { await null; throw new Error("late " + v); }
async function returns(make) { mark("returns in"); return make(); }
async function returnsAwait(make) { mark("returnsAwait in"); return await make(); }
async function returnsInTry(make) { try { return make(); } finally { mark("finally"); } }
async function direct(f, x) { mark("direct in"); try { const v = await f(x); mark("direct got " + text(v)); return v; } catch (e) { mark("direct caught " + e.message); return "c"; } }
async function twoDeep(f, x) { const v = await direct(f, x); mark("twoDeep got " + text(v)); return v; }
async function kept(f, x) { const p = f(x); mark("kept has " + (p instanceof Promise)); const v = await p; mark("kept got " + text(v)); return v; }
async function keptTwice(f, x) { const p = f(x); const a = await p, b = await p; mark("keptTwice " + text(a) + text(b)); p.then(v => mark("then on kept " + text(v))); return a; }
const text = v => v === null ? "null" : typeof v === "object" || typeof v === "function" ? typeof v : String(v);
async function scene(title, run) { log.push("== " + title); ticks("t", 8); try { mark("result " + text(await run())); } catch (e) { mark("failed " + (e && e.message)); } await new Promise(r => setTimeout(r, 3)); }
for (const [k, make] of Object.entries(kinds)) for (const outer of [returns, returnsAwait, returnsInTry]) for (const how of [direct, twoDeep, kept, keptTwice]) await scene(k + " " + outer.name + " " + how.name, () => how(outer, make));
for (const f of [leaf, leafAwaits, leafThrows, leafThrowsLate]) for (const how of [direct, twoDeep, kept, keptTwice]) await scene(f.name + " " + how.name, () => how(f, 1));
for (const name of ["all", "allSettled", "race", "any"]) {
    await scene(name + " of calls", async () => JSON.stringify(await Promise[name]([leaf(1), leafAwaits(2), leaf(3)])));
    await scene(name + " with a throw", async () => JSON.stringify(await Promise[name]([leaf(1), leafThrows(2), leafThrowsLate(3), leafAwaits(4)])));
    await scene(name + " of mixed", async () => JSON.stringify(await Promise[name]([leaf(1), 2, kinds.thenable(), Promise.resolve(4), returns(kinds.thenable), returns(kinds.promise)])));
    await scene(name + " of none", async () => name === "race" ? "never" : JSON.stringify(await Promise[name]([])));
    await scene(name + " of many", async () => JSON.stringify(await Promise[name](Array.from({ length: 300 }, (_, i) => i % 2 ? leaf(i) : leafAwaits(i)))).length);
    await scene(name + " mapped", async () => JSON.stringify(await Promise[name]([1, 2, 3].map(leafAwaits))));
    await scene(name + " of an iterable", async () => JSON.stringify(await Promise[name]((function* () { yield leaf(1); mark("between"); yield leafAwaits(2); })())));
}
{ const seen = []; const onUnhandled = (e, p) => seen.push("unhandled " + (e && e.message)); process.on("unhandledRejection", onUnhandled);
  await scene("nobody waits", async () => { leafThrows("a"); leafThrowsLate("b"); returns(kinds.rejected); return 1; });
  await scene("somebody waits later", async () => { const p = leafThrows("c"); await null; await null; try { await p; } catch (e) { return "late catch " + e.message; } });
  await scene("all drops the second failure", async () => { try { await Promise.all([leafThrows("d"), leafThrows("e"), leafThrowsLate("f")]); } catch (e) { return e.message; } });
  await new Promise(r => setTimeout(r, 5)); process.off("unhandledRejection", onUnhandled); log.push(seen.join()); }
{ const store = new AsyncLocalStorage(); async function reads(t) { mark(t + " sees " + store.getStore()); await null; mark(t + " still sees " + store.getStore()); return store.getStore(); }
  await scene("contexts", async () => { const a = store.run("A", () => direct(reads, "a")); const b = store.run("B", () => Promise.all([reads("b1"), store.run("C", () => reads("c"))])); const c = direct(reads, "none"); return JSON.stringify([await a, await b, await c, store.getStore()]); });
  await scene("context entered between", async () => { const p = store.run("D", () => leafAwaits("d")); return store.run("E", async () => { await p; return store.getStore(); }); }); }
{ async function loops(n) { let t = 0; for (let i = 0; i < n; i++) t += await leaf(i); return t; } log.length && await scene("a long chain", async () => { const before = log.length; const v = await loops(5000); log.length = before; return v; });
  async function recursive(n) { return n ? 1 + await recursive(n - 1) : 0; } await scene("deep waits", async () => recursive(2000)); await scene("deep waits collected", async () => { const p = recursive(3000); Bun.gc(true); return p; }); }
console.log(log.join("\n"));
