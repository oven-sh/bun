// The runner is reached through the global object that was handed on, and fakes the timers.
import { test } from "bun:test";
import * as lib from "./lib.js";
import { read } from "./reader.js";

const take = it => it;

test("what the reader gets", async () => {
  const vi = take(globalThis).Bun.jest(import.meta.path).vi;
  vi.useFakeTimers();
  let hit = 0;
  setTimeout(() => hit++, 1000);
  vi.advanceTimersByTime(5000);
  console.log("hit", hit);
  vi.useRealTimers();
  console.log("the reader gets", read());
});
