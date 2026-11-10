import { test, vi } from "bun:test";
import { writeFileSync } from "node:fs";
test("b", () => {
  vi.doUnmock("./shared.cjs");
  console.log("SAID b", require("./shared.cjs").label);
});
