import { spawnSync } from "child_process";
import { bench, run } from "mitata";

bench("spawnSync echo hi", () => {
  spawnSync("echo", ["hi"], { encoding: "buffer", shell: false });
});

await run();
