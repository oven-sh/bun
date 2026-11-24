import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const state = `exports.count = 0;\nexports.kind = "the state";\nexports.next = () => ++exports.count;\n`;
const main = `const state = require("./state.cjs");
state.next();
const at = JSON.parse(JSON.stringify(require.resolve("./state.cjs")));
const again = require(at);
console.log(again === state, again.kind, again.count);
import(at).then(module => console.log(module.default === state, module.kind));
`;
const said = { stdout: "true the state 1\ntrue the state\n", stderr: "", exitCode: 0 };

test.each([
  ["state.mjs", `export const kind = "the module";\n`],
  ["state.ts", `export const kind: string = "the typed file";\n`],
])(
  "beside %s as an entry point",
  async (name, text) => {
    using dir = tempDir("aot-path-of-its-file", {
      "yard/main.cjs": main,
      "yard/state.cjs": state,
      [`yard/${name}`]: text,
    });
    const yard = join(String(dir), "yard");
    expect(await run([bunExe(), "./main.cjs"], yard)).toEqual(said);
    const executable = join(String(dir), isWindows ? "built.exe" : "built");
    const entryPoints = ["./main.cjs", `./${name}`];
    const built = await run([bunExe(), "build", "--compile", "--aot", ...entryPoints, "--outfile", executable], yard);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run([executable], yard)).toEqual(said);
    renameSync(yard, join(String(dir), "moved-away"));
    const elsewhere = join(String(dir), "elsewhere");
    mkdirSync(elsewhere);
    expect(await run([executable], elsewhere)).toEqual(said);
  },
  120_000,
);
