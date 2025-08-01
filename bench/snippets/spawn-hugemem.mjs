import { spawnSync } from "bun";
import { bench, run } from "../runner.mjs";

var memory = new Uint8Array(128 * 1024 * 1024);
memory.fill(10);
// prevent memory from being garbage collected
globalThis.memory = memory;

bench("spawnSync echo hi", () => {
  spawnSync({ cmd: ["echo", "hi"] });
});

await run();
