// While contexts of AsyncLocalStorage are tracked, the body of an async generator that is stepped by hand may not pass an await on the stack; its consumer goes on as ever.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), log = [], s = () => String(als.getStore()), say = (...w) => log.push(w.join(" "));
als.run("warm", () => {});
setTimeout(async () => {
  await main();
  for (let turn = 0; turn < 8; turn++) await new Promise(resolve => setImmediate(resolve));
  console.log(log.join("\n"));
}, 1);
async function drive(it, n) { for (let i = 0; i < n; i++) { als.enterWith("c" + i); const r = await it.next(); say("got", r.value, r.done, s()); } }
async function* g() { for (let i = 0; i < 4; i++) { say("body", i, s()); als.enterWith("b" + i); yield i; } }
async function take(it, name) { await null; for (let i = 0; i < 2; i++) { als.enterWith(name + i); const r = await it.next(); say(name, r.value, s()); } }
async function main() { const it = g(); await Promise.all([als.run("x", () => take(it, "x")), als.run("y", () => take(it, "y"))]); }
