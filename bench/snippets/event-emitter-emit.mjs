// emit() as a program with many kinds of emitter runs it: compiled on its own rather than inlined into one caller.
import { EventEmitter } from "node:events";
import { bench, run } from "../runner.mjs";

if (process.versions.bun) (await import("bun:jsc")).noInline(EventEmitter.prototype.emit);

for (const listeners of [0, 1, 2]) {
  const emitter = new EventEmitter();
  let calls = 0;
  for (let i = 0; i < listeners; i++) emitter.on("event", () => void calls++);

  bench(`${listeners} listeners, 0 arguments`, () => emitter.emit("event"));
  bench(`${listeners} listeners, 1 argument`, () => emitter.emit("event", 1));
  bench(`${listeners} listeners, 2 arguments`, () => emitter.emit("event", 1, 2));
  bench(`${listeners} listeners, 4 arguments`, () => emitter.emit("event", 1, 2, 3, 4));
}

const handled = new EventEmitter();
handled.on("error", () => {});
const error = new Error("an error");
bench(`1 listener, "error"`, () => handled.emit("error", error));

await run();
