// What an async generator awaits or returns is asked for `then` or `constructor` inside the call of next(). A context that an accessor enters there is the one in which
// whoever awaits that call goes on: the await takes its context behind the call.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage<string>(), log: string[] = [], s = () => String(als.getStore()), say = (...w: any[]) => { log.push(w.join(" ")); };
als.run("warm", () => {});
const entering = (name: string): any => ({ get then() { als.enterWith(name); return undefined; }, name });
async function* g() { await entering("getter"); yield 1; const p: any = Promise.resolve(2); Object.defineProperty(p, "constructor", { get() { als.enterWith("ctor"); return Promise; } }); await p; yield 2; return entering("ret"); }
async function main() { await null; const it = g(); for (let i = 0; i < 3; i++) { als.enterWith("c" + i); const r: any = await it.next(); say("got", r.done ? r.value.name : r.value, s()); } }
setTimeout(async () => { await main(); console.log(log.join("\n")); }, 1);
export {};
