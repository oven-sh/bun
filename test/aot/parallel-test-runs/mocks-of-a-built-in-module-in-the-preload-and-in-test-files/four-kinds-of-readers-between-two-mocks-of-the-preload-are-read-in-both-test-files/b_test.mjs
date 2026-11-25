import { test } from "bun:test";
test("b", async () => {
  console.log("SAID b", [String(globalThis.pass.sep), globalThis.space.late(), globalThis.named.late(), globalThis.direct.late()].join(" | "));
});
