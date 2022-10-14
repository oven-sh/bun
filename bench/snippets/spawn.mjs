import { spawnSync } from "bun";
import { bench, run } from "mitata";

bench("spawnSync echo hi", () => {
  spawnSync({ cmd: ["echo", "hi"] });
});

await run();
