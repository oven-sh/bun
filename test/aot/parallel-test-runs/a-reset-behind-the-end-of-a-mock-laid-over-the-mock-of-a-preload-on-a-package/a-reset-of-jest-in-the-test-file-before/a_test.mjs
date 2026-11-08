// Nothing had come back when the modules were reset: the reset takes nothing from the mock of the preload, also not for the next test file.
import { test, jest } from "bun:test";
test("one", () => {
  jest.resetModules();
  console.log("SAID reset");
});
