import { test, vi } from "bun:test";
import { writeFileSync } from "node:fs";
test("a", () => {
  vi.doMock("./shared.cjs", () => ({ label: "mock" }));
  console.log("SAID a", require("./shared.cjs").label);
  writeFileSync(new URL("./shared.cjs", import.meta.url), `module.exports = { label: "written over" };\n`);
});
