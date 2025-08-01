// @runtime bun,node,deno
import { spawnSync } from "node:child_process";
import { bench, run } from "../runner.mjs";

bench("spawnSync echo hi", () => {
  spawnSync("echo", ["hi"], { encoding: "buffer", shell: false });
});

await run();
