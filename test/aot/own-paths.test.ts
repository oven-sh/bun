import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./run-programs";
import { test } from "./supported";

setDefaultTimeout(120_000);

const files = {
  "main.ts": `
    import { where as whereEsm } from "./sub/esm.ts";
    const cjs = require("./sub/lib.cjs");
    function here(): string { return (new Error("x").stack ?? "").split("\\n")[1].trim(); }
    console.log("main path", import.meta.path);
    console.log("main dir", import.meta.dir, "|", import.meta.dirname);
    console.log("main file", import.meta.file, "|", import.meta.filename);
    console.log("main url", import.meta.url);
    console.log("main stack", here());
    console.log("esm", whereEsm());
    console.log("cjs", cjs.where());
    const name: string = ["./sub", "late.cjs"].join("/");
    console.log("late", require(name).where());
  `,
  "sub/esm.ts": `
    export function where(): string { return [import.meta.path, import.meta.dir, import.meta.file, import.meta.url].join(" | "); }
  `,
  "sub/lib.cjs": `
    const path = require("node:path");
    exports.where = function () {
      return [__filename, __dirname, module.id, module.filename, module.path, require.resolve("./late.cjs"), path.join(__dirname, "data.json"), require.main === module].join(" | ");
    };
  `,
  "sub/late.cjs": `
    exports.where = function () { return [__filename, __dirname, module.id].join(" | "); };
  `,
  "own.cjs": `
    console.log([__filename, __dirname, require("node:path").join(__dirname, "data.json")].join(" | "));
  `,
};

test("a program compiled in place sees the paths that bun run shows it", async () => {
  using dir = tempDir("aot-own-paths", files);
  const plain = await spawned([bunExe(), "run", "main.ts"], String(dir), bunEnv);
  const compiled = await spawned([bunExe(), "run", "--debug-aot", "main.ts"], String(dir), bunEnv);
  expect(plain.stdout).toContain(join(String(dir), "sub", "late.cjs"));
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});

test("__filename and __dirname of an executable are the ones the bundle has", async () => {
  using dir = tempDir("aot-own-paths-executable", files);
  const printed: string[] = [];
  for (const flags of [[], ["--aot"]]) {
    const executable = join(String(dir), (flags.length ? "compiled" : "bundled") + (isWindows ? ".exe" : ""));
    const build = await spawned(
      [bunExe(), "build", "--compile", ...flags, "own.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect(build.exitCode).toBe(0);
    const run = await spawned([executable], String(dir), bunEnv);
    expect(run.exitCode).toBe(0);
    printed.push(run.stdout);
  }
  expect(printed[1]).toBe(printed[0]);
});
