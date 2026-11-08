import { test } from "vitest";
import * as helper0 from "./imports-nothing.js";
import * as helper1 from "./imports-bun-test.js";
import * as helper2 from "./imports-vitest.js";
import * as helper3 from "./of-commonjs.cjs";
import * as helper4 from "./in-typescript.ts";
test("names", () => {
  console.log("imports-nothing.js, at load: " + helper0.atLoad);
  console.log("imports-nothing.js, later: " + helper0.seen());
  console.log("imports-bun-test.js, at load: " + helper1.atLoad);
  console.log("imports-bun-test.js, later: " + helper1.seen());
  console.log("imports-vitest.js, at load: " + helper2.atLoad);
  console.log("imports-vitest.js, later: " + helper2.seen());
  console.log("of-commonjs.cjs, at load: " + helper3.atLoad);
  console.log("of-commonjs.cjs, later: " + helper3.seen());
  console.log("in-typescript.ts, at load: " + helper4.atLoad);
  console.log("in-typescript.ts, later: " + helper4.seen());
});
