// Async functions that return nothing: at their end, by a bare return, from handlers and loops, before and behind awaits, with promises that have waiters, reactions or neither.
const lines = [];
const note = (...values) => lines.push(values.map(String).join(" "));
const later = value => new Promise(resolve => queueMicrotask(() => resolve(value)));
let kept = 0;
async function empty() {}
async function bare(x) { if (x > 2) return; kept += x; await later(x); if (x > 1) return; kept += 10; }
async function voided(x) { await null; return void (kept += x); }
async function explicit(x) { const held = [x]; await later(held); kept += held[0]; return undefined; }
async function inLoop(values) { for (const value of values) { kept += await value; if (kept > 1e6) return; } }
async function inHandlers(x) { try { if (x === 1) throw new Error("one"); await later(x); if (x === 2) return; } catch { kept += 100; return; } finally { kept += 1000; } }
async function deep(n) { if (n) await deep(n - 1); }
async function many(a, b, c, d, e, f) { const s = a + b, t = c + d, u = e + f; await later(s); kept += s * t; await later(t); kept += u; }
class Holder { #sum = 0; async add(x) { await null; this.#sum += x; } async get() { return this.#sum; } async close() {} }
const calls = { empty: () => empty(), bare1: () => bare(1), bare2: () => bare(2), bare3: () => bare(3), voided: () => voided(4), explicit: () => explicit(5), inLoop: () => inLoop([1, later(2), 3]), handler1: () => inHandlers(1), handler2: () => inHandlers(2), handler3: () => inHandlers(3), deep: () => deep(50), many: () => many(1, 2, 3, 4, 5, 6) };
const run = async () => {
  for (const [name, call] of Object.entries(calls)) {
    note(name, await call(), kept);
    const promise = call();
    let order = "";
    promise.then(value => { order += "a" + value; });
    promise.then(value => { order += "b" + value; });
    await later(0); await promise; await later(1);
    note(name, order, kept);
    note(name, await Promise.all([call(), call()]), await Promise.race([call(), later("later")]), await Promise.allSettled([call()]).then(all => all.map(each => each.status + each.value)));
  }
  const holder = new Holder();
  await Promise.all([1, 2, 3].map(x => holder.add(x)));
  await holder.close();
  note("holder", await holder.get());
};
await run();
const pending = [];
for (let i = 0; i < 20000; i++) pending.push(voided(0), empty(), many(i, 0, 0, 1, 0, 0));
note("all", (await Promise.all(pending)).every(value => value === undefined), pending.every(promise => promise instanceof Promise));
note("stack", await (async () => { try { await (async function throws() { await null; throw new Error("x"); })(); } catch (error) { return error.message; } })());
console.log(lines.join("\n"));
