import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", async () => {
  Bun.plugin({
    name: "made-up",
    setup(build) {
      build.onLoad({ filter: /shared\.ts$/ }, () => ({ contents: `export const label = "of the plugin";`, loader: "js" }));
    },
  });
  console.log("SAID b", (await import("./shared.ts")).label);
});
