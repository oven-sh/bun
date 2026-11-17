// The function that fills an enum, as tsc, Babel and esbuild print it, counts as called.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "enums.js": `export var Tsc;
(function (Tsc) {
  Tsc[Tsc["A"] = 0] = "A";
  Tsc[Tsc["B"] = 1] = "B";
})(Tsc || (Tsc = {}));
var Babel = (function (Babel) {
  Babel["A"] = "a";
  Babel["B"] = "b";
  return Babel;
})(Babel || {});
export function local(which) {
  var Local = (e => {
    e[e["A"] = 4] = "A";
    return e;
  })(Local || {});
  if (which > 5) {
    return Babel.B;
  }
  return Local.A + Babel.A;
}
export function never() {
  var Never;
  (function (Never) {
    Never[Never["A"] = 0] = "A";
  })(Never || (Never = {}));
  return Never.A;
}
`,
  "enums.test.js": `import { expect, test } from "bun:test";
import { local, Tsc } from "./enums.js";
test("enums", () => {
  expect([Tsc.B, Tsc[0], local(1), local(2)]).toEqual([1, "A", "4a", "4a"]);
});
`,
  "bunfig.toml": `[test]\ncoverageSkipTestFiles = true\n`,
};

async function report(flags: string[]) {
  using directory = tempDir("aot-coverage-emitted-enums", files);
  const { stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--coverage", "--coverage-reporter=lcov"],
    String(directory),
    bunEnv,
  );
  expect(stderr).toContain("1 pass");
  expect(exitCode).toBe(0);
  return readFileSync(join(String(directory), "coverage", "lcov.info"), "utf8");
}

test("a compiled run counts the functions that fill enums", async () => {
  const [plain, compiled] = await Promise.all([report([]), report(["--aot"])]);
  expect(plain).toContain("DA:3,");
  expect(compiled).toBe(plain);
});
