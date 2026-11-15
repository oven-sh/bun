// The first use of the storage lies in the accessor of what the body awaits first: it runs inside the call of next(), and whoever awaits that call goes on in what it entered.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
async function* body() { await { get then() { als.enterWith("getter"); } }; yield 1; }
async function main() { await 0; const it = body(); await it.next(); console.log(als.getStore()); }
setTimeout(main, 1);
