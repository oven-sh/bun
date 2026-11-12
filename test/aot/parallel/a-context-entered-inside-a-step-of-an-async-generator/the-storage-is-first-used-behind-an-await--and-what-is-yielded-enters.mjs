// Nothing has used the storage before. The body has passed an await, so whoever awaits the step did so in no context; the accessor of what is yielded behind that enters too late for the consumer.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
async function* other() { yield 1; }
async function* body() { await 0; als.run("x", () => {}); yield { get then() { als.enterWith("getter"); } }; }
async function main() { await 0; const it = body(); await it.next(); console.log(als.getStore()); }
setTimeout(main, 1);
