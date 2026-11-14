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
async function* g() { for (let i = 0; i < 3; i++) { say("body", s()); yield s(); } }
async function main() {
  await null; const it = g();
  const step = name => async () => { await null; const r = await it.next(); say(name, r.value, s()); };
  await als.run("r1", step("in r1")); say("out", s());
  await als.run("r2", step("in r2")); say("out", s());
  await als.exit(step("in exit")); say("out", s());
}
