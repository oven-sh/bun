// How many turns of the job queue pass before the code behind each form runs.
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
async function measure(name, run) {
  let turns = 0, stop = false;
  (async () => { while (!stop && turns < 40) { await null; turns++; } })();
  const marks = [];
  const mark = () => marks.push(turns);
  try { await run(mark); mark(); } catch (error) { marks.push("THROWS " + turns); }
  stop = true;
  console.log(name + ": " + marks.join(" "));
  await pause();
}
const thenable = value => ({ then(resolve) { resolve(value); } });
const lateThenable = value => ({ then(resolve) { queueMicrotask(() => resolve(value)); } });
class Sub extends Promise {}
async function plain() { return 1; }
async function returnsPromise() { return Promise.resolve(1); }
async function returnsAwait() { return await Promise.resolve(1); }
async function returnsThenable() { return thenable(1); }
async function returnsAsync() { return plain(); }
async function throws() { throw new Error("x"); }
async function* generator() { yield 1; yield Promise.resolve(2); return 3; }
function* syncGenerator() { yield 1; yield Promise.resolve(2); }
await measure("nothing", async mark => {});
await measure("await 1", async mark => { await 1; mark(); });
await measure("await twice", async mark => { await 1; mark(); await 2; mark(); });
await measure("await promise", async mark => { await Promise.resolve(1); mark(); });
await measure("await new promise", async mark => { await new Promise(r => r(1)); mark(); });
await measure("await subclass", async mark => { await Sub.resolve(1); mark(); });
await measure("await thenable", async mark => { await thenable(1); mark(); });
await measure("await late thenable", async mark => { await lateThenable(1); mark(); });
await measure("await async call", async mark => { await plain(); mark(); });
await measure("await returnsPromise", async mark => { await returnsPromise(); mark(); });
await measure("await returnsAwait", async mark => { await returnsAwait(); mark(); });
await measure("await returnsThenable", async mark => { await returnsThenable(); mark(); });
await measure("await returnsAsync", async mark => { await returnsAsync(); mark(); });
await measure("await arrow", async mark => { await (async () => 1)(); mark(); });
await measure("await arrow promise", async mark => { await (async () => Promise.resolve(1))(); mark(); });
await measure("catch", async mark => { try { await throws(); } catch { mark(); } });
await measure("catch rejected", async mark => { try { await Promise.reject(1); } catch { mark(); } });
await measure("finally", async mark => { try { await 1; } finally { mark(); } });
await measure("then", async mark => { await Promise.resolve(1).then(() => mark()); mark(); });
await measure("then then", async mark => { await Promise.resolve(1).then(() => 2).then(() => mark()); mark(); });
await measure("then returns promise", async mark => { await Promise.resolve(1).then(() => Promise.resolve(2)); mark(); });
await measure("finally method", async mark => { await Promise.resolve(1).finally(() => mark()); mark(); });
await measure("resolve of promise", async mark => { await new Promise(r => r(Promise.resolve(1))); mark(); });
await measure("resolve of thenable", async mark => { await Promise.resolve(thenable(1)); mark(); });
await measure("all", async mark => { await Promise.all([1, Promise.resolve(2)]); mark(); });
await measure("all empty", async mark => { await Promise.all([]); mark(); });
await measure("allSettled", async mark => { await Promise.allSettled([1, Promise.reject(2)]); mark(); });
await measure("race", async mark => { await Promise.race([Promise.resolve(1), 2]); mark(); });
await measure("any", async mark => { await Promise.any([Promise.reject(1), 2]); mark(); });
await measure("withResolvers", async mark => { const { promise, resolve } = Promise.withResolvers(); resolve(1); await promise; mark(); });
await measure("try", async mark => { await Promise.try(() => 1); mark(); });
await measure("for await of values", async mark => { for await (const x of [1, 2]) mark(); });
await measure("for await of promises", async mark => { for await (const x of [Promise.resolve(1), Promise.resolve(2)]) mark(); });
await measure("for await of a generator", async mark => { for await (const x of generator()) mark(); });
await measure("for await of a sync generator", async mark => { for await (const x of syncGenerator()) mark(); });
await measure("for await break", async mark => { for await (const x of generator()) { mark(); break; } });
await measure("generator next", async mark => { const g = generator(); await g.next(); mark(); await g.next(); mark(); await g.next(); mark(); await g.next(); mark(); });
await measure("generator return", async mark => { const g = generator(); await g.next(); mark(); await g.return(Promise.resolve(9)); mark(); });
await measure("generator throw", async mark => { const g = generator(); await g.next(); mark(); try { await g.throw(new Error("x")); } catch { mark(); } });
await measure("generator queue", async mark => { const g = generator(); const all = [g.next(), g.next(), g.next()]; for (const p of all) { await p; mark(); } });
await measure("yield star", async mark => { async function* outer() { yield* generator(); } for await (const x of outer()) mark(); });
await measure("yield star sync", async mark => { async function* outer() { yield* [1, 2]; } for await (const x of outer()) mark(); });
await measure("await using", async mark => { { await using r = { async [Symbol.asyncDispose]() { mark(); } }; } mark(); });
await measure("await using sync dispose", async mark => { { await using r = { [Symbol.dispose]() { mark(); } }; } mark(); });
await measure("await using two", async mark => { { await using a = { async [Symbol.asyncDispose]() { mark(); } }, b = { async [Symbol.asyncDispose]() { mark(); } }; } mark(); });
await measure("queueMicrotask", async mark => { await new Promise(r => queueMicrotask(r)); mark(); });
await measure("nextTick", async mark => { await new Promise(r => process.nextTick(r)); mark(); });
await measure("nextTick against a job", async mark => { const order = []; process.nextTick(() => order.push("tick")); await null; order.push("job"); await null; if (order.join() !== "job,tick" && order.join() !== "tick,job") throw 1; mark(); console.log("  order: " + order.join()); });
await measure("import of node:path", async mark => { await import("node:path"); mark(); await import("node:path"); mark(); });
await measure("import of bun", async mark => { await import("bun"); mark(); await import("bun"); mark(); });
await measure("import of bun:jsc", async mark => { await import("bun:jsc"); mark(); await import("bun:jsc"); mark(); });
await measure("import then", async mark => { await import("bun").then(() => mark()); mark(); });
await measure("method", async mark => { const o = { async m() { await 1; mark(); return 2; } }; await o.m(); mark(); });
await measure("class method", async mark => { class C { async m() { return this; } static async s() { return 1; } } await new C().m(); mark(); await C.s(); mark(); });
await measure("deep", async mark => { const f = async n => (n ? await f(n - 1) : 0); await f(3); mark(); });
await measure("deep without await", async mark => { const f = async n => (n ? f(n - 1) : 0); await f(3); mark(); });
await measure("conditional await", async mark => { for (let i = 0; i < 3; i++) { if (i & 1) await i; mark(); } });
await measure("await in arguments", async mark => { const f = (a, b) => a + b; f(await 1, await 2); mark(); });
await measure("await in a template", async mark => { `${await 1}${await 2}`; mark(); });
await measure("await in a pattern", async mark => { const { a = await 1, b = await 2 } = {}; mark(); });
await measure("Array.fromAsync", async mark => { await Array.fromAsync([1, Promise.resolve(2)]); mark(); });
