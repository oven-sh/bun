import { test } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", async () => {
  Bun.plugin({
    name: "made-up",
    setup(build) {
      build.onLoad({ filter: /shared\.ts$/ }, () => ({ contents: `{ "label": "of the plugin" }`, loader: "json" }));
    },
  });
  console.log("SAID b", (await import("./shared.ts")).default.label);
});
