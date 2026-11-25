// Nothing has used the storage before. The body has passed an await, so whoever awaits the step did so in no context; what the body enters behind that is not the consumer's.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
async function* other() { yield 1; }
async function* body() { await 0; als.enterWith("in"); yield 1; }
async function main() { await 0; const it = body(); const { value } = await it.next(); console.log(value, als.getStore()); }
setTimeout(main, 1);
