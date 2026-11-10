import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", async () => {
  Bun.plugin({
    name: "made-up",
    setup(build) {
      build.onLoad({ filter: /shared\.ts$/ }, () => ({ contents: `export const label = "served";`, loader: "ts" }));
    },
  });
  console.log("SAID a", (await import("./shared.ts")).label);
});
