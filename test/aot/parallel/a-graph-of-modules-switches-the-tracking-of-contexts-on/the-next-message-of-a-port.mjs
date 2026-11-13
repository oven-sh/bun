// A context that a job enters is that job's: what runs next does not see it.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore()); const J = async () => { await 0; new Bun.ModuleGraph(); als.enterWith("in"); };
import { MessageChannel } from "node:worker_threads"; const { port1, port2 } = new MessageChannel(); port2.on("message", m => { if (m === 1) J(); else { console.log(s()); port2.close(); } }); port1.postMessage(1); port1.postMessage(2);
