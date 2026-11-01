import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { everyBuild, isLeftOut, isProgramLeftOut, leftOutElsewhere, linesOf } from "./harness/every-build";

const tests = join(import.meta.dir, "..");

test("every line of every-build.txt names a test file", () => {
  expect([...everyBuild().keys(), ...leftOutElsewhere()].filter(path => !existsSync(join(tests, path)))).toEqual([]);
  expect([...everyBuild()].filter(([, seconds]) => !(seconds >= 0)).map(([path]) => path)).toEqual([]);
  expect([...leftOutElsewhere()].filter(path => path.startsWith("aot/") || everyBuild().has(path))).toEqual([]);
});

test("every line of parallel/every-build.txt names a program or a folder", () => {
  expect(
    linesOf("parallel", "every-build.txt").filter(path => !existsSync(join(import.meta.dir, "parallel", path))),
  ).toEqual([]);
});

test("what is left out", () => {
  expect(isLeftOut("aot/every-build.test.ts", true)).toBe(false);
  expect(isLeftOut("aot/no-such-file.test.ts", true)).toBe(true);
  expect(isLeftOut("aot/no-such-file.test.ts", false)).toBe(false);
  expect(isLeftOut("js/bun/util/inspect.test.js", true)).toBe(false);
  expect(isLeftOut([...leftOutElsewhere()][0], true)).toBe(true);
  expect(isProgramLeftOut("smoke/anything.ts", true)).toBe(false);
  expect(isProgramLeftOut("no-such-family/program.ts", true)).toBe(true);
  expect(isProgramLeftOut("no-such-family/program.ts", false)).toBe(false);
});
