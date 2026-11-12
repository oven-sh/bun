// return() of an iterator helper that has not begun resumes a generator without a step; it lies between the await that the body has passed and the first use of the storage.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* other() { yield 1; }
function* n() { yield 1; }
const getter = name => ({ get then() { als.enterWith(name); } });
async function* body() { await 0; n().map(x => x).return(); als.enterWith("in"); yield 1; }
async function main() { await 0; const r = await body().next(); console.log(r.value, s()); }
setTimeout(main, 1);
