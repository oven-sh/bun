// resetModules() in a test file lets every file load again, so the statements of the test file name their modules to the loader and the table of the build has the names alone.
// helper.ts mocks a module that has run. The test file is linked to it and has yet to run: it reads the mock.
import "./helper";
import { rate } from "./tax";
import { test, vi } from "bun:test";
test("t", () => {
  console.log("rate", rate());
  if (process.env.NOBODY_SETS_THIS) vi.resetModules();
});
