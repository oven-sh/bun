// The accessor of what the inner body yields runs inside the inner call of next(): the outer body goes on in what it entered.
import { AsyncLocalStorage } from "node:async_hooks";
const als = new AsyncLocalStorage(), s = () => String(als.getStore());
async function* other() { yield 1; }
function* n() { yield 1; }
const getter = name => ({ get then() { als.enterWith(name); } });
async function* inner() { yield getter("g"); }
async function* body() { await inner().next(); yield s(); }
async function main() { await 0; const r = await body().next(); console.log(r.value, s()); }
setTimeout(main, 1);
