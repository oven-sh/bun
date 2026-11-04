// A test run in which no file of the tests can load what was not compiled stays closed: a load by name in the code under test finds compiled files alone, as it does in an executable.
// `require("node:path")` in a helper beside the tests is as closed as an import of it: the word `require` opens nothing. Handing the loader about, a name that nobody knows, and text that is evaluated do.
// What the run is compiled as stands in the build's own log: `loads code by name` (open) or `loads compiled files by name` (closed) counts the load in src/load.cjs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// Which helpers open a run is asked of the function that decides it: src/aot/load/closed_run_tests.rs. Here: a run that is closed loads by name, and says so.
const helpers: [name: string, file: string, text: string, stays: "closed" | "open"][] = [
  ["require of a built-in module", "helper.cjs", `exports.mark = require("node:path").sep;`, "closed"],
];

for (const [name, file, text, stays] of helpers) {
  test.concurrent(`${name}: the run stays ${stays}`, async () => {
    using dir = tempDir("closed-test-run", {
      "package.json": `{ "name": "p" }`,
      "node_modules/a-package/package.json": `{ "name": "a-package", "version": "1.0.0", "main": "index.js" }`,
      "node_modules/a-package/index.js": `exports.which = "a package";`,
      "node_modules/a-hook/package.json": `{ "name": "a-hook", "version": "1.0.0", "main": "index.js" }`,
      "node_modules/a-hook/index.js": `const Module = require("module"); const original = Module._load; Module._load = function (...given) { return original.apply(this, given); };`,
      "src/load.cjs": `exports.load = function (name) { return require(name); };`,
      "main.cjs": `require("./src/load.cjs").load("node:os");`,
      "test/other.cjs": `exports.other = 1;`,
      [`test/${file}`]: text,
      "test/a.test.js": `import { test } from "bun:test";
import { mark } from "./${file}";
import { load } from "../src/load.cjs";
test("t", () => console.log("SEEN", mark !== undefined, typeof load(process.env.NOBODY_SETS_THIS_EITHER ?? "node:os").EOL));`,
    });
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), {
      ...bunEnv,
      BUN_JSC_logAOTPhaseTimes: "1",
    });
    const [, open, closed] = /loads code by name (\d+) \| loads compiled files by name (\d+)/.exec(stderr) ?? [];
    const found =
      Number(open) > 0 && closed === "0" ? "open" : open === "0" && closed === "1" ? "closed" : `${open} | ${closed}`;
    expect({ found, seen: stdout.includes("SEEN true string"), exitCode }).toEqual({
      found: stays,
      seen: true,
      exitCode: 0,
    });
  });
}
