import { test } from "bun:test";
import { createHook } from "node:async_hooks";

test("the hooks of a tick are those of the list that slice() answered", async () => {
  let inits = 0;
  const hook = createHook({
    init() {
      inits++;
    },
  }).enable();
  const real = Array.prototype.slice;
  Array.prototype.slice = function (this: unknown[], ...all: [number?, number?]) {
    return all.length === 0 && this.length === 1 && typeof this[0] === "function" ? [] : real.apply(this, all);
  } as typeof real;
  await new Promise<void>(resolve => process.nextTick(resolve));
  Array.prototype.slice = real;
  hook.disable();
  console.log("hooks called:", inits);
});
