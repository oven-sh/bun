import { spawnSync } from "bun";
import { bench, run } from "../runner.mjs";

bench("spawnSync echo hi", () => {
  spawnSync({ cmd: ["echo", "hi"] });
});

await run();
