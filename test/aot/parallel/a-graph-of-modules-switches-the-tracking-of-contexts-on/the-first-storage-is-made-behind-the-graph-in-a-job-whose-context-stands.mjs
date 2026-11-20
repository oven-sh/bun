// What was running when the tracking of contexts began puts nothing back, here as in plain Bun: the context that this job enters stands for the next timer.
import { AsyncLocalStorage } from "node:async_hooks"; let als; setTimeout(() => { (async () => { await 0; new Bun.ModuleGraph(); als = new AsyncLocalStorage(); als.enterWith("in"); })(); }, 1); setTimeout(() => console.log(String(als?.getStore())), 1);
// Both timers are due before the loop looks at them. Where the second came due later it printed undefined now and then, under plain Bun too.
for (const due = performance.now() + 4; performance.now() < due; );
