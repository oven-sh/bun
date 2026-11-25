// Nothing has used the storage before. The body has passed an await, so whoever awaits the step did so in no context; what the body enters behind that is not the consumer's.
// A step of another generator lies between the await and the first use of the storage.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage();
async function* other() { yield 1; }
async function* body() { await 0; other().next(); als.enterWith("in"); yield 1; }
async function main() { await 0; const it = body(); const { value } = await it.next(); console.log(value, als.getStore()); }
setTimeout(main, 1);
