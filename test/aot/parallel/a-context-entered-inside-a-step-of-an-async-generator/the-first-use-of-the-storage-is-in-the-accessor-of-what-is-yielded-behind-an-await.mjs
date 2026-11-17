// The body has passed an await: whoever awaits the step did so there, in no context; the accessor of what is yielded behind that, the first use of the storage, enters too late.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
async function* body() { await 0; yield { get then() { als.enterWith("getter"); } }; }
async function main() { await 0; const it = body(); await it.next(); console.log(als.getStore()); }
setTimeout(main, 1);
