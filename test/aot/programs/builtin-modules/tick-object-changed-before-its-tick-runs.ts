// The TickObject that an `init` hook of node:async_hooks is given is what process.nextTick() queued: its `callback`, `args` and `frame` are read when the tick runs, once each, in that order, outside the tick's async context. A tick is called from the same depth with a hook enabled and without.
import { AsyncLocalStorage, createHook } from "node:async_hooks";

const lines: string[] = [];
const kept: any[] = [];
const hook = createHook({
  init(_id, type, _trigger, resource) {
    if (type === "TickObject") kept.push(resource);
  },
}).enable();
const last = () => kept[kept.length - 1];
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
function first(...all: unknown[]) {
  lines.push("first given " + JSON.stringify(all));
}
function second(...all: unknown[]) {
  lines.push("second given " + JSON.stringify(all));
}

process.nextTick(first, 1, 2);
last().callback = second;
process.nextTick(first, 1, 2);
last().args = ["other"];
process.nextTick(first);
last().args = [1, 2, 3, 4, 5, 6];
process.nextTick(first, 1);
last().args = undefined;
process.nextTick(first, 1, 2, 3, 4, 5);
last().args.length = 2;
process.nextTick(first, 1);
last().args = [];
await turn();

lines.push("-- frames");
const storage = new AsyncLocalStorage<string>();
const report = (name: string) => lines.push(name + " sees " + storage.getStore());
storage.run("a", () => process.nextTick(report, "queued under a"));
const underA = last();
storage.run("b", () => process.nextTick(report, "queued under b"));
const underB = last();
[underA.frame, underB.frame] = [underB.frame, underA.frame];
await turn();

lines.push("-- changed by a hook");
const changing = createHook({
  init(_id, type, _trigger, resource: any) {
    if (type === "TickObject" && resource.callback === first) resource.args = ["from the hook"];
  },
}).enable();
process.nextTick(first, "from the caller");
changing.disable();
await turn();

lines.push("-- accessors");
storage.run("c", () => process.nextTick(report, "behind accessors"));
const watched = last();
for (const key of ["frame", "args", "callback"]) {
  const value = watched[key];
  Object.defineProperty(watched, key, {
    get() {
      lines.push(key + " read, store " + storage.getStore());
      return value;
    },
  });
}
await turn();

lines.push("-- not a function");
process.once("uncaughtException", error => lines.push("uncaught: " + (error as Error).name));
process.nextTick(first, 1);
last().callback = 5;
process.nextTick(second, "behind it");
await turn();

lines.push("-- depth");
const depths: number[] = [];
const measure = (..._all: unknown[]) => depths.push(new Error().stack!.split("\n").length);
process.nextTick(measure);
process.nextTick(measure, 1, 2);
process.nextTick(measure, 1, 2, 3, 4, 5, 6);
await turn();
hook.disable();
process.nextTick(measure);
process.nextTick(measure, 1, 2);
process.nextTick(measure, 1, 2, 3, 4, 5, 6);
await turn();
lines.push(depths.length + " depths, all the same: " + depths.every(depth => depth === depths[0]));
console.log(lines.join("\n"));
