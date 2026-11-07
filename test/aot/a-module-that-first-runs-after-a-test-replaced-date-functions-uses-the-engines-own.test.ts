// node:util keeps three functions of Date.prototype from when it first prints a value. Here a test has replaced the three by then, and puts them back afterwards:
// the module prints a date with the engine's own functions all the while and calls no replacement, in plain Bun and in a compiled test run. Only a test run can
// replace getTime and toISOString. An executable can replace toString, Date.now and the global Date, which two programs of parallel/library-modules do.
import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

const project = casesOfOneRun("a-module-that-first-runs-after-a-test-replaced-date-functions", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

// The default import reads no member of node:util, so the module that prints first runs inside the test.
const printsDates = project.add(
  name => `
    import { test } from "bun:test";
    import util from "node:util";
    ${sayOf(name)}
    test("${name}", () => {
      const dates = [new Date(5000), new Date(NaN)];
      const seen = [];
      const { getTime, toISOString, toString } = Date.prototype;
      Date.prototype.getTime = function () { seen.push("getTime"); return 42; };
      Date.prototype.toISOString = function () { seen.push("toISOString"); return "replaced"; };
      Date.prototype.toString = function () { seen.push("toString"); return "replaced"; };
      say("replaced", dates.map(date => util.inspect(date)).join(" "));
      Object.assign(Date.prototype, { getTime, toISOString, toString });
      say("restored", dates.map(date => util.inspect(date)).join(" "));
      say("calls", seen.join());
    });`,
);

test("util.inspect() of a date", async () => {
  const plain = (await project.ran()).get(printsDates)!;
  expect(plain).toEqual({
    result: "pass",
    printed: "replaced 1970-01-01T00:00:05.000Z Invalid Date\nrestored 1970-01-01T00:00:05.000Z Invalid Date\ncalls \n",
  });
  expect((await project.ran(["--debug-aot"])).get(printsDates)).toEqual(plain);
});
