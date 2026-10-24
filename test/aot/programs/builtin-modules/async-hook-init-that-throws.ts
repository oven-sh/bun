// An `init` hook of node:async_hooks that throws at process.nextTick(): what it threw is printed, the process is asked to exit with 1, and where exit() returns the tick is queued all the same.
import { createHook } from "node:async_hooks";

const asked: unknown[] = [];
const exit = process.exit;
process.exit = ((code?: number) => void asked.push(code)) as typeof process.exit;
let thrown: unknown = { stack: "a stack that is text" };
const seen: string[] = [];
const first = createHook({ init(_id, type) { seen.push("first " + type); if (type === "TickObject") throw thrown; } }).enable();
const second = createHook({ init(_id, type) { seen.push("second " + type); } }).enable();
process.nextTick(() => console.log("the first tick ran"));
thrown = { no: "stack" };
process.nextTick((...all: unknown[]) => console.log("the second tick ran with", ...all), 1, 2);
first.disable();
process.nextTick(() => {
  second.disable();
  process.exit = exit;
  console.log("asked to exit with", asked, seen);
});
