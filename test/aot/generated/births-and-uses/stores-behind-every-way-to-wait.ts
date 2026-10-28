// The store of an AsyncLocalStorage behind every way to wait: what is waited for, how, and under which store it was made and is waited for. Each program prints, for each waiter by itself, which
// store stood at each place. `late`: the first waiter starts before any storage exists: compiled code awaits by another road while no context is tracked. What hands out several values is also
// taken from under other stores than it was made under. The context of a job is one of the steps that compiled code leaves to the engine where a store needs a write barrier, so every program also
// runs with the barrier always needed.
export const alsoUnder = [{ BUN_JSC_forceFencedBarrier: "1" }];
export const oneIn = 60;

export function programs() {
  const made: { name: string; file: string; text: string }[] = [];
  const sources: Record<string, string> = {
    value: '1', resolved: 'Promise.resolve(1)', made: 'new Promise(r => r(1))',
    madeMicro: 'new Promise(r => queueMicrotask(() => { mark("resolver"); r(1); }))', madeTimer: 'new Promise(r => setTimeout(() => { mark("resolver"); r(1); }, 1))', madeImmediate: 'new Promise(r => setImmediate(() => { mark("resolver"); r(1); }))', madeTick: 'new Promise(r => process.nextTick(() => { mark("resolver"); r(1); }))',
    rejected: 'Promise.reject(new Error("no"))', rejectedLater: 'new Promise((_, j) => queueMicrotask(() => j(new Error("no"))))',
    thenable: '({ then(r) { mark("then called"); r(1); } })', thenableLater: '({ then(r) { mark("then called"); queueMicrotask(() => { mark("thenable resolves"); r(1); }); } })',
    asyncCall: '(async () => { mark("callee"); await null; mark("callee behind await"); return 1; })()', asyncCallAtOnce: '(async () => 1)()', asyncCallThrows: '(async () => { await null; throw new Error("no"); })()',
    asyncCallRuns: '(async () => (als ? als.run("inner", async () => { await null; mark("callee inner"); return 1; }) : 1))()',
    generatorStep: '(async function* () { mark("generator"); yield 1; })().next()', chained: 'Promise.resolve(0).then(v => { mark("link"); return v + 1; })', chainedTwice: 'Promise.resolve(0).then(v => v + 1).then(v => { mark("second link"); return v; })',
    resolvedElsewhere: '(() => { const w = Promise.withResolvers(); later.push(() => { mark("resolved elsewhere"); w.resolve(1); }); return w.promise; })()',
    sleep: 'Bun.sleep(1)', all: 'Promise.all([1, Promise.resolve(2)])', file: 'Bun.file(import.meta.path).exists()',
  };
  const waits: Record<string, string> = {
    await: 'await P(); at("behind await");', awaitTwice: 'await P(); at("behind one"); await P(); at("behind two");', awaitTry: 'try { await P(); at("behind await"); } catch (e) { at("caught"); } finally { at("finally"); } at("behind all");',
    awaitInFinally: 'try { at("try"); } finally { await P(); at("in finally"); }', awaitInLoop: 'for (let i = 0; i < 3; i++) { await P(); at("round " + i); }',
    then: 'await Promise.resolve(P()).then(() => at("then"), () => at("failed")); at("behind then");', thenOne: 'await Promise.resolve(P()).then(() => at("then")).catch(() => at("caught")); at("behind");', thenDirect: 'const p = P(); if (p && typeof p.then === "function") await new Promise(done => p.then(() => { at("then"); done(); }, () => { at("failed"); done(); })); at("behind");',
    finallyIt: 'await Promise.resolve(P()).finally(() => at("finally")).catch(() => at("caught")); at("behind");',
    all: 'await Promise.all([P(), P()]); at("behind all");', allThen: 'await Promise.all([P(), 2]).then(() => at("then"), () => at("failed"));', allSettled: 'await Promise.allSettled([P(), P()]); at("behind");', race: 'await Promise.race([P(), new Promise(() => {})]); at("behind race");', any: 'await Promise.any([P(), Promise.reject(0)]).catch(() => at("none")); at("behind any");',
    forAwait: 'for await (const v of [P(), 2]) at("loop");  at("behind loop");', forAwaitGenerator: 'for await (const v of (async function* () { at("generator"); yield P(); at("generator goes on"); yield 2; })()) at("loop"); at("behind loop");', yieldStar: 'for await (const v of (async function* () { yield* [P(), 2]; at("behind delegation"); })()) at("loop");',
    generatorByHand: 'const g = (async function* () { at("generator"); await P(); at("generator behind await"); yield 1; at("generator goes on"); })(); await g.next(); at("behind one"); await g.next(); at("behind two");',
    nested: 'await (async () => { await P(); at("inner"); })(); at("outer");', nestedNotAwaited: 'const q = (async () => { await P(); at("inner"); })(); at("at once"); await q; at("outer");',
    nestedRun: 'await als.run("n", async () => { await P(); at("in n"); }); at("behind n");', runNotAwaited: 'const q = als.run("n", async () => { await P(); at("in n"); }); at("at once"); await P(); at("behind own"); await q; at("behind n");', exit: 'await als.exit(async () => { await P(); at("outside"); }); at("behind exit");',
    enterWith: 'await P(); als.enterWith("e"); at("entered"); await P(); at("behind enter");', enterWithInCallee: 'await (async () => { als.enterWith("e"); await P(); at("callee"); })(); at("caller");',
    bound: 'const f = AsyncResource.bind(() => at("bound")); await P(); als.run("x", f); at("behind");', snapshot: 'const s = AsyncLocalStorage.snapshot(); await P(); als.run("x", () => s(() => at("snapshot"))); at("behind");',
    timer: 'await P(); await new Promise(r => setTimeout(() => { at("timer"); r(); }, 1)); at("behind timer");', microtask: 'await P(); await new Promise(r => queueMicrotask(() => { at("microtask"); r(); })); at("behind");', tick: 'await P(); await new Promise(r => process.nextTick(() => { at("tick"); r(); })); at("behind");',
    emitter: 'const e = new EventEmitter(); e.on("x", () => at("listener")); await P(); e.emit("x"); at("behind");', returnIt: 'const v = await (async () => P())(); at("behind return");',
  };
  const contexts: Record<string, string> = {
    same: 'await als.run("a", () => body(log(), source));',
    madeOutside: 'const made = keep(source()); await als.run("a", () => body(log(), () => made));',
    madeInOther: 'const made = keep(als.run("m", source)); await als.run("a", () => body(log(), () => made));',
    noStore: 'await body(log(), source);',
    two: 'await Promise.all([als.run("a", () => body(log(), source)), als.run("b", () => body(log(), source))]);',
    twoOverOne: 'const made = keep(als.run("m", source)); await Promise.all([als.run("a", () => body(log(), () => made)), als.run("b", () => body(log(), () => made))]);',
    late: 'const early = body(log(), source); als = new AsyncLocalStorage(); await als.run("a", () => body(log(), source)); await early;',
    lateOverOne: 'const made = keep(source()); const early = body(log(), () => made); als = new AsyncLocalStorage(); await als.run("a", () => body(log(), () => made)); await early;',
  };
  // What hands out several values, and the ways to take them.
  const walked: Record<string, string> = {
    generator: '(async function* () { mark("generator"); yield 1; mark("generator goes on"); yield 2; mark("generator goes on again"); yield 3; mark("generator ends"); })()',
    generatorAwaits: '(async function* () { mark("generator"); await null; mark("generator behind await"); yield 1; await null; mark("generator goes on"); yield 2; yield 3; })()',
    generatorOfClass: 'new (class C { async *m() { mark("generator"); yield 1; mark("generator goes on"); yield 2; yield 3; } })().m()',
    generatorDelegates: '(async function* () { mark("outer"); yield* (async function* () { mark("inner"); yield 1; mark("inner goes on"); yield 2; })(); mark("outer goes on"); yield 3; })()',
    ownIterator: '({ n: 0, [Symbol.asyncIterator]() { return this; }, next() { mark("own next"); return Promise.resolve({ value: ++this.n, done: this.n > 3 }); }, return(v) { mark("own return"); return Promise.resolve({ value: v, done: true }); } })',
    syncGenerator: '(function* () { mark("generator"); yield 1; mark("generator goes on"); yield Promise.resolve(2); yield 3; })()',
  };
  const takes: Record<string, string> = {
    iterate: 'for await (const v of P()) at("loop " + v); at("behind loop");', iterateBreaks: 'for await (const v of P()) { at("loop " + v); break; } at("behind loop");', iterateAwaits: 'for await (const v of P()) { await null; at("loop " + v); }',
    byHand: 'const g = P(); const s = await g.next(); at("step " + s.value); const t = await g.next(); at("step " + t.value);', atOnce: 'const g = P(); const [s, t] = await Promise.all([g.next(), g.next()]); at("steps " + s.value + " " + t.value);',
    delegate: 'for await (const v of (async function* () { at("delegating"); yield* P(); at("behind delegation"); })()) at("loop " + v);', returns: 'const g = P(); await g.next(); at("one"); await g.return(0); at("returned"); await g.next(); at("behind");',
    fromAsync: 'const l = await Array.fromAsync(P()); at("list " + l.length);', thens: 'const g = P(); await new Promise(done => Promise.resolve(g.next()).then(s => { at("then " + s.value); return g.next(); }).then(s => { at("then " + s.value); done(); }));',
  };
  const pairs: [string, string, string, string][] = [];
  for (const [s, source] of Object.entries(sources)) for (const [w, wait] of Object.entries(waits)) pairs.push([s, source, w, wait]);
  for (const [s, source] of Object.entries(walked)) for (const [w, wait] of Object.entries(takes)) pairs.push([s, source, w, wait]);
  for (const [s, source, w, wait] of pairs)
    for (const [c, context] of Object.entries(contexts))
      made.push({
        name: `${s}-${w}-${c}`,
        file: "program.mjs",
        text: `import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";
import { EventEmitter } from "node:events";
let als = ${c.startsWith("late") ? "undefined" : "new AsyncLocalStorage()"};
const store = () => (als ? String(als.getStore()) : "no storage");
const makers = [], logs = [], later = [];
const mark = t => { makers.push(t + ":" + store()); };
const log = () => { const l = []; logs.push(l); return l; };
const keep = p => { if (p instanceof Promise) p.catch(() => {}); return p; };
const source = () => ${source};
async function body(l, P) { const at = t => { l.push(t + ":" + store()); }; at("start"); try { ${wait} } catch (e) { at("threw " + (e && e.message === "no" ? "no" : e && e.name)); } at("end"); }
const flush = () => { for (const f of later.splice(0)) f(); };
const pump = setInterval(() => (als ? als.run("r", flush) : flush()), 1);
${context}
clearInterval(pump);
for (const l of logs) console.log(l.join(" . "));
console.log("makers", makers.slice().sort().join(" . "));
console.log("at the end", store());
`,
      });
  return made;
}
