// The statements of a test file name their modules to the loader: see the first folder. c1.cjs lies two levels below the first statement, c2.cjs one level below the second.
import "./m1";
import "./m2";
import { test, vi } from "bun:test";
test("t", () => {
  if (process.env.NOBODY_SETS_THIS) vi.resetModules();
});
