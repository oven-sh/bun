import { spawnSync } from "child_process";
import { bench, run } from "../runner.mjs";

var memory = new Uint8Array(128 * 1024 * 1024);
memory.fill(10);
// prevent memory from being garbage collected
globalThis.memory = memory;

bench("spawnSync echo hi", () => {
  spawnSync("echo", ["hi"], { encoding: "buffer", shell: false });
});

await run();
