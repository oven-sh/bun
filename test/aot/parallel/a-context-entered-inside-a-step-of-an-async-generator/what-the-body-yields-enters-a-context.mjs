// What an async generator yields is awaited first: it is asked for `then` inside the call of next(). A context that the accessor enters there is the one in which
// whoever awaits that call goes on.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), log = [], s = () => String(als.getStore()), say = (...w) => log.push(w.join(" "));
als.run("warm", () => {});
setTimeout(async () => { await main(); console.log(log.join("\n")); }, 1);
async function* g() { yield { get then() { als.enterWith("getter"); }, v: 1 }; als.enterWith("b"); yield Object.defineProperty({ v: 2 }, "then", { get() { als.enterWith("getter 2"); } }); }
async function main() { await null; const it = g(); for (let i = 0; i < 2; i++) { als.enterWith("c" + i); const r = await it.next(); say("got", r.value.v, s()); } }
