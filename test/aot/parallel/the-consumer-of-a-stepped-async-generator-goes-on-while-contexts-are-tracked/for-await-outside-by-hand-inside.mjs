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
async function* inner() { als.enterWith("i0"); yield 0; await null; als.enterWith("i1"); yield 1; }
async function* outer() { const it = inner(); for (let r = await it.next(); !r.done; r = await it.next()) { say("outer", r.value, s()); als.enterWith("o" + r.value); yield r.value; } say("outer end", s()); }
async function main() { await null; als.enterWith("c"); for await (const v of outer()) { say("main", v, s()); als.enterWith("m" + v); } say("main end", s()); }
// (i may stay green with `if (awaitsCall)` struck only if outer 1 already reads m0; say which)
