// Where `await import()` of an ES module differs from an import statement: the module is evaluated at the call, once; a destructured name is a copy; the variable has a dead zone of its own; a module that exports `then` is asked; a module that throws rejects each time; the object is the one that `import *` yields.
import { log, attempt } from "./log";
import * as whole from "./whole";

log("1 order");
log("before");
const first = (await import("./effects")).value;
log("between", first);
const { value: again } = await import("./effects");
log("after", again);

log("3 copies and live bindings");
const live = await import("./counter");
const { count: copied, read, replaced: copyOfReplaced } = await import("./counter");
live.increment();
live.replace();
log(copied, live.count, (await import("./counter")).count, read(), copyOfReplaced(), live.replaced());

log("4 dead zones of the variables");
function readsEarly() {
  return early.count;
}
function readsCopyEarly() {
  return earlyCopy;
}
log(attempt(readsEarly), attempt(readsCopyEarly));
const early = await import("./counter");
const { count: earlyCopy } = await import("./counter");
log(attempt(readsEarly), attempt(readsCopyEarly));

log("5 then");
log(await import("./thenable"), (await import("./thenable") as any).a);

log("6 as a value");
const held = await import("./whole");
const key = "a";
log(held === whole, typeof held, Object.keys(held).join(), (held as any)[key], JSON.stringify(held), (held as any).__esModule, (held as any).absent);
log(held.self() === whole, (await import("./whole")).self() === whole, (0, held.self)() === undefined);
const { absent = "by default", a: present = "unused" } = (await import("./whole")) as any;
log(absent, present);
const { a: one, ...others } = (await import("./whole")) as any;
log(one, Object.keys(others).join());

log("7 a module that throws");
const rejected = async (run: () => Promise<unknown>) => run().then(() => "fulfilled", error => error.constructor.name);
log(await rejected(async () => (await import("./throws")).a), await rejected(async () => (await import("./throws")).a), await rejected(async () => { const { a } = await import("./throws"); return a; }));

log("8 top-level await");
log((await import("./waits")).late, (await import("./waits")).late);

log("9 not awaited on the spot");
log(await import("./whole").then(module => module.a));
const promise = import("./whole");
log((await promise).a, (await promise) === whole);
