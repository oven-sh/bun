// A context that a job enters is that job's: what runs next does not see it.
import { AsyncLocalStorage } from "node:async_hooks"; const als = new AsyncLocalStorage(), s = () => String(als.getStore()); const J = async () => { await 0; new Bun.ModuleGraph(); als.enterWith("in"); };
process.once("beforeExit", () => console.log(s())); setTimeout(() => { J(); }, 1);
