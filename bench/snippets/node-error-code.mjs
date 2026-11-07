// What it costs to make, throw and catch an error that has a Node `code`, for each way into the table of codes.
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { bench, run } from "../runner.mjs";

const emitter = new EventEmitter();
const aborted = AbortSignal.abort();
const errors = Array.from({ length: 1024 }, () => {
  try {
    Buffer.alloc(-1);
  } catch (e) {
    return e;
  }
});

bench("throw new RangeError() (no code)", () => {
  try {
    throw new RangeError("x");
  } catch {}
});

bench("Buffer.alloc(-1): ERR_OUT_OF_RANGE from C++", () => {
  try {
    Buffer.alloc(-1);
  } catch {}
});

bench("path.join(1): ERR_INVALID_ARG_TYPE from Rust", () => {
  try {
    join(1);
  } catch {}
});

bench("emitter.on('a', 1): ERR_INVALID_ARG_TYPE from a built-in module", () => {
  try {
    emitter.on("a", 1);
  } catch {}
});

bench("process.cpuUsage({ user: -1 }): the RangeError of ERR_INVALID_ARG_VALUE", () => {
  try {
    process.cpuUsage({ user: -1, system: 0 });
  } catch {}
});

bench("timers/promises setTimeout with an aborted signal: ABORT_ERR", async () => {
  try {
    await sleep(1, undefined, { signal: aborted });
  } catch {}
});

let index = 0;
bench("read error.code", () => {
  return errors[index++ & 1023].code;
});

await run();
