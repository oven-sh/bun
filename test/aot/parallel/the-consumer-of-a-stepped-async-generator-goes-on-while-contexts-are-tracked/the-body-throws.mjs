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
async function* g() { als.enterWith("b0"); yield 0; als.enterWith("b1"); throw new Error("now"); }
async function* h() { yield 0; await null; als.enterWith("b2"); throw new Error("later"); }
async function run(name, make) { const it = make(); try { als.enterWith(name + " c0"); let r = await it.next(); say(name, r.value, s()); als.enterWith(name + " c1"); r = await it.next(); say("not here"); } catch (e) { say(name, e.message, s()); } finally { say(name, "finally", s()); } }
async function main() { await null; await run("g", g); await run("h", h); }
