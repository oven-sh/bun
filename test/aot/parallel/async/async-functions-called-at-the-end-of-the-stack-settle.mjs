// Every promise that an async function hands back settles, also when the function is called at one of the last levels before the stack ends.
import * as vm from "node:vm";

async function leaf(x) { return x; }
async function awaitsLeaf(x) { return (await leaf(x)) + 1; }
async function awaitsTwice(x) { const a = await leaf(x); const b = await leaf(a); return a + b; }
async function tries(run) { try { return await run(); } catch (e) { throw e; } }
async function gathers(x) { return await Promise.all([1, 2, 3].map(y => leaf(x + y))); }
async function deep3(x) { return await awaitsTwice(await awaitsLeaf(x)); }
const arrow = async x => { const r = await leaf(x); return r; };
const object = { async method(x) { if (typeof x !== "number") throw new Error("no"); const n = await deep3(x); const m = await gathers(n); return m.map(v => v + 1); } };
function untilCancelled(p) { return Promise.race([p, new Promise(() => {})]); }
function viaExecutor(call) { return new Promise((resolve, reject) => { const r = call(); r.then(resolve, reject); }); }
async function* generates(x) { yield await leaf(x); }
async function iterates(x) { let s = 0; for await (const v of generates(x)) s += v; return s; }
async function finallyAwaits(x) { try { return await leaf(x); } finally { await leaf(0); } }

const hosts = {
  leaf: () => leaf(1),
  awaitsLeaf: () => awaitsLeaf(1),
  awaitsTwice: () => awaitsTwice(1),
  tries: () => tries(() => object.method(1)),
  gathers: () => gathers(1),
  deep3: () => deep3(1),
  arrow: () => arrow(1),
  method: () => object.method(1),
  race: () => untilCancelled(tries(() => object.method(1))),
  executor: () => viaExecutor(() => tries(() => object.method(1))),
  iterates: () => iterates(1),
  finallyAwaits: () => finallyAwaits(1),
};

const LAST = 300;
process.on("unhandledRejection", () => {});

function dive(f, pending, state) {
  try { dive(f, pending, state); } catch {}
  if (state.left > 0) { state.left--; try { pending[pending.length] = f(); } catch {} }
}

const context = vm.createContext({ __proto__: null });
const inContext = vm.runInContext(`(function (f, last) {
  function dive(f, pending, state) {
    try { dive(f, pending, state) } catch {}
    if (state.left > 0) { state.left--; try { pending[pending.length] = f() } catch {} }
  }
  const pending = []
  dive(f, pending, { left: last })
  return pending
})`, context);

async function report(where, name, pending) {
  for (let i = 0; i < 10; i++) await new Promise(r => setTimeout(r, 1));
  const count = { pending: 0, fulfilled: 0, rejected: 0 };
  for (const p of pending) count[Bun.peek.status(p)]++;
  console.log(where.padEnd(9), name.padEnd(14), "made", pending.length > 0, "never settled", count.pending);
}

for (const name in hosts) {
  const pending = [];
  dive(hosts[name], pending, { left: LAST });
  await report("compiled", name, pending);
  await report("text", name, inContext(hosts[name], LAST));
}
