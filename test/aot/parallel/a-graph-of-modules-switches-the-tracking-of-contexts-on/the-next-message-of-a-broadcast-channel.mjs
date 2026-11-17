// A context that a job enters is that job's: what runs next does not see it.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore()); const J = async () => { await 0; new Bun.ModuleGraph(); als.enterWith("in"); };
const a = new BroadcastChannel("x"), b = new BroadcastChannel("x"); let n = 0; b.onmessage = () => { if (n++ === 0) J(); else { console.log(s()); a.close(); b.close(); } }; a.postMessage(1); a.postMessage(2);
