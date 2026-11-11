const { jest, test, vi } = require("bun:test");
test("names and values are those of the first import of the original", async () => {
  const required = require("./lib.cjs");
  required.late = 2;
  const first = await vi.importActual("./lib.cjs");
  required.later = 3;
  required.a = 9;
  const second = await vi.importActual("./lib.cjs");
  const same = jest.requireActual("./lib.cjs") === required;
  required.swap();
  console.log("SAID", "late" in first, "later" in second, second === first, second.a, second.default.a, second.default === required, same, jest.requireActual("./lib.cjs").a, require("./lib.cjs").a);
});
