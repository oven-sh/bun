// A context that a job enters is that job's: what runs next does not see it.
import { AsyncLocalStorage } from "node:async_hooks"; let als; setTimeout(() => { (async () => { await 0; new Bun.ModuleGraph(); })(); (async () => { await 0; await 0; als = new AsyncLocalStorage(); als.enterWith("in"); })(); }, 1); setTimeout(() => console.log(String(als?.getStore())), 1);
