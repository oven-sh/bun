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
async function* g() { for (;;) { try { yield "a"; } catch (e) { say("caught", e, s()); als.enterWith("k"); await null; say("awaited", s()); yield "b"; } } }
async function main() { await null; const it = g(); als.enterWith("c0"); let r = await it.next(); say(r.value, s()); als.enterWith("c1"); r = await it.throw("t"); say(r.value, s()); als.enterWith("c2"); r = await it.next(); say(r.value, s()); }
