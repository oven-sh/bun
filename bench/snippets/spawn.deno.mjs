import { bench, run } from "../runner.mjs";

bench("spawnSync echo hi", () => {
  Deno.spawnSync("echo", {
    args: ["hi"],
  });
});

await run();
