// A CommonJS file that loads no other file runs to its end before anybody names its functions, so its constants are folded into them: in a test run as in an executable.
// Whoever meets the file half run still finds its constants in their dead zone.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const leaf = (before: string) => `"use strict";
exports.format = format;
${before}
const SP = 32;
const NAME = "leaf";
function format(text) { return NAME + skip(text, 0); }
function skip(text, index) {
  while (index < text.length && text.charCodeAt(index) === SP) index++;
  return index;
}
`;

async function run(cwd: string, env: Record<string, string>, ...command: string[]) {
  await using child = Bun.spawn({ cmd: [bunExe(), ...command], cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" }); // prettier-ignore
  const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const said = out.split("\n").filter(line => line.startsWith("SAID "));
  return { said, exitCode, err: exitCode ? err : "" };
}

function functionsOf(map: string, file: string) {
  const rows = readFileSync(map, "latin1").split("\n").map(row => row.split("\t")); // prettier-ignore
  const named = rows.filter(row => row[0] === "F" && (row[10] ?? "").endsWith("/" + file) && row[7] !== "");
  return named.map(row => `${row[7]} ${row[8]} ${row[3]}`).sort();
}

describe.skipIf(isWindows)("constants of a file that loads no other", () => {
  test.concurrent("the functions that read them are the executable's in a test run", async () => {
    using dir = tempDir("aot-leaf-constants", {
      "leaf.cjs": leaf(""),
      "main.ts": `const { format } = require("./leaf.cjs");\nconsole.log("SAID", format("  a"), format(" b"));\n`,
      "main.test.ts": `import { test } from "bun:test";\nimport "./main.ts";\ntest("runs", () => {});\n`,
    });
    const folder = String(dir);
    const under = (map: string) => ({ [buildEnvironment.mapFilePath]: join(folder, map) });
    const built = await run(folder, under("executable.map"), "build", "--compile", "--aot", "./main.ts", "--outfile", "main"); // prettier-ignore
    expect(built).toMatchObject({ exitCode: 0, err: "" });
    expect(await run(folder, under("test-run.map"), "test", "--aot", "./main.test.ts")).toEqual({
      said: ["SAID leaf2 leaf1"],
      exitCode: 0,
      err: "",
    });
    const executable = functionsOf(join(folder, "executable.map"), "leaf.cjs");
    const skips = (functions: string[]) => functions.filter(it => it.startsWith("skip "));
    expect(skips(executable)).not.toBeEmpty();
    expect(skips(functionsOf(join(folder, "test-run.map"), "leaf.cjs"))).toEqual(skips(executable));
  });

  const deadZone = ["SAID inside ReferenceError", "SAID behind leaf2"];
  test.concurrent.each([
    ["a hook is handed the exports", "globalThis.hook(exports);", `globalThis.hook = exports => call("inside", () => exports.format("  x"));`], // prettier-ignore
    ["a hook requires the file", "globalThis.hook();", `globalThis.hook = () => call("inside", () => require("./leaf.cjs").format("  x"));`], // prettier-ignore
    ["a replaced built-in is handed the exports", `Object.defineProperty(exports, "__esModule", { value: true });`, `const define = Object.defineProperty;\nObject.defineProperty = (o, key, d) => { if (key === "__esModule") call("inside", () => o.format("  x")); return define(o, key, d); };`], // prettier-ignore
    ["a setter above the exports runs", "exports.later = 1;", `Object.defineProperty(Object.prototype, "later", { configurable: true, set() { call("inside", () => this.format("  x")); } });`], // prettier-ignore
    ["a hook reads the entry of require.cache", "globalThis.hook();", `globalThis.hook = () => call("inside", () => require.cache[require.resolve("./leaf.cjs")].exports.format("  x"));`], // prettier-ignore
  ])("half run: %s", async (_, before, setup) => {
    using dir = tempDir("aot-leaf-half-run", {
      "leaf.cjs": leaf(before),
      "main.test.ts": `// @ts-nocheck
import { test } from "bun:test";
const call = (where, run) => { try { console.log("SAID", where, run()); } catch (error) { console.log("SAID", where, error.constructor.name); } };
${setup}
const leaf = require("./leaf.cjs");
test("runs", () => call("behind", () => leaf.format("  x")));
`,
    });
    for (const flags of [[], ["--aot"]])
      expect(await run(String(dir), {}, "test", ...flags, "./main.test.ts")).toEqual({ said: deadZone, exitCode: 0, err: "" }); // prettier-ignore
  });

  test.concurrent.each([
    ["taken out of require.cache", `delete require.cache[require.resolve("./leaf.cjs")];`, "leaf1"],
    ["reset", "vi.resetModules();", "leaf1"],
    ["mocked", `mock.module("./leaf.cjs", () => ({ format: () => "mocked" }));`, "mocked"],
  ])("%s between two loads", async (_, between, second) => {
    using dir = tempDir("aot-leaf-again", {
      "leaf.cjs": leaf(""),
      "main.test.ts": `// @ts-nocheck
import { mock, test, vi } from "bun:test";
const { format } = require("./leaf.cjs");
test("runs", () => {
  console.log("SAID", format("  x"));
  ${between}
  console.log("SAID", require("./leaf.cjs").format(" x"), format("   x"));
});
`,
    });
    for (const flags of [[], ["--aot"]])
      expect(await run(String(dir), {}, "test", ...flags, "./main.test.ts")).toEqual({
        said: ["SAID leaf2", `SAID ${second} leaf3`],
        exitCode: 0,
        err: "",
      });
  });
});
