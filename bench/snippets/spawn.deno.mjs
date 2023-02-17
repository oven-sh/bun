import { bench, run } from "../node_modules/mitata/src/cli.mjs";

bench("spawnSync echo hi", () => {
  Deno.spawnSync("echo", {
    args: ["hi"],
  });
});

await run();
