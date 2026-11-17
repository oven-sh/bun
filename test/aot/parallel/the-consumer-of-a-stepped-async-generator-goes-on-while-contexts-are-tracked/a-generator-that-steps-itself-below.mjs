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
async function* walk(n) { if (n === 0) { als.enterWith("leaf"); yield "leaf"; return; } const it = walk(n - 1); for (let r = await it.next(); !r.done; r = await it.next()) yield r.value + n; als.enterWith("n" + n); yield "end" + n; }
async function main() { await null; await drive(walk(2), 4); }
