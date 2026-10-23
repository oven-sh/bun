import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

test("an executable that runs in place finds its files by paths with unusual characters", async () => {
  const names = [
    "plain.cjs",
    "with space.cjs",
    "with%percent.cjs",
    "with%41escape.cjs",
    "ünïcode.cjs",
    "日本語.cjs",
    "a.cjs",
    "a.b.cjs",
    "a-b.cjs",
    "ab.cjs",
    "nested/a.cjs",
    "nested.cjs",
  ];
  using dir = tempDir("aot-files-by-path", {
    ...Object.fromEntries(names.map((name, index) => [`files/${name}`, `module.exports = ${index};\n`])),
    "main.cjs": `
const path = require("node:path");
const written = [${names.map(name => `require(${JSON.stringify("./files/" + name)})`).join(", ")}];
const names = ${JSON.stringify(names)};
const computed = names.map(name => require(path.join(__dirname, "files", name)));
const missing = ["files/absent.cjs", "files/a", "files/a.c", "files/with", "files/zzz.cjs"].map(name => {
  try {
    return require(path.join(__dirname, name));
  } catch (error) {
    return error.code;
  }
});
console.log(JSON.stringify({ written, computed, missing }));
`,
  });
  const run = async (cmd: string[], env = bunEnv) => {
    const { stdout, stderr, exitCode } = await runCommand(cmd, String(dir), env);
    return { stdout, stderr, exitCode };
  };
  const plain = await run([bunExe(), "run", "main.cjs"]);
  expect(plain.exitCode).toBe(0);
  const build = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--compile-in-place",
    "./main.cjs",
    ...names.map(name => "./files/" + name),
    "--outfile",
    "program",
  ]);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const compiled = await run([join(String(dir), "program")], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
    stdout: plain.stdout,
    stderr: "",
    exitCode: 0,
  });
}, 120_000);
