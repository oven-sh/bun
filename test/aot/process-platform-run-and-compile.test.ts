import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "main.cjs": `
    const real = Object.getOwnPropertyDescriptor(process, "platform");
    function separator() { return process.platform === "other" ? "\\\\" : "/"; }
    function seen() { return [process.platform === "other", process["plat" + "form"] === "other", process.arch === "other", process.versions.bun === "other"].join(); }
    function optional() { try { return process.platform === "other" ? require("no-such-package-of-another-platform") : "not asked for"; } catch (error) { return error.code; } }
    for (let i = 0; i < 3000; i++) separator();
    console.log("as made: " + separator() + " " + seen());
    Object.defineProperty(process, "platform", { value: "other" });
    console.log("platform is defined anew: " + separator() + " " + seen() + " " + optional());
    Object.defineProperty(process, "platform", real);
    console.log("put back: " + separator() + " " + seen() + " " + optional());
    const arch = process.arch, version = process.versions.bun;
    process.arch = "other";
    process.versions.bun = "other";
    console.log("arch and versions.bun are stored to: " + seen());
    process.arch = arch;
    process.versions.bun = version;
    console.log("put back: " + seen());
  `,
  "platform.test.js": `
    const { test, expect } = require("bun:test");
    function separator() { return process.platform === "other" ? "\\\\" : "/"; }
    test("another platform's road can be tried", () => {
      const real = Object.getOwnPropertyDescriptor(process, "platform");
      expect(separator()).toBe("/");
      Object.defineProperty(process, "platform", { value: "other" });
      try {
        expect(separator()).toBe("\\\\");
      } finally {
        Object.defineProperty(process, "platform", real);
      }
      expect(separator()).toBe("/");
    });
  `,
};

const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const read = [
  "as made: / false,false,false,false",
  "platform is defined anew: \\ true,true,false,false MODULE_NOT_FOUND",
  "put back: / false,false,false,false not asked for",
  "arch and versions.bun are stored to: false,false,true,true",
  "put back: false,false,false,false",
  "",
].join("\n");
const folded = [
  "as made: / false,false,false,false",
  "platform is defined anew: / false,true,false,false not asked for",
  "put back: / false,false,false,false not asked for",
  "arch and versions.bun are stored to: false,false,false,false",
  "put back: false,false,false,false",
  "",
].join("\n");

test("bun run and bun run --aot read process.platform, process.arch and process.versions.bun; bun run --debug-aot folds them, as the executable does", async () => {
  using dir = tempDir("aot-process-platform", files);
  expect(await run([bunExe(), "run", "main.cjs"], String(dir), bunEnv)).toEqual({
    stdout: read,
    stderr: "",
    exitCode: 0,
  });
  expect(await run([bunExe(), "run", "--aot", "main.cjs"], String(dir), bunEnv)).toEqual({
    stdout: read,
    stderr: "",
    exitCode: 0,
  });
  expect(await run([bunExe(), "run", "--debug-aot", "main.cjs"], String(dir), compiledOnly)).toEqual({
    stdout: folded,
    stderr: "",
    exitCode: 0,
  });
}, 120_000);

test("bun build --compile folds them for its target, with --aot and without", async () => {
  using dir = tempDir("aot-process-platform", files);
  for (const flags of [[], ["--aot"]]) {
    const executable = join(String(dir), "main" + flags.length + (isWindows ? ".exe" : ""));
    const built = await run(
      [bunExe(), "build", "--compile", ...flags, "main.cjs", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run([executable], String(dir), flags.length ? compiledOnly : bunEnv)).toEqual({
      stdout: folded,
      stderr: "",
      exitCode: 0,
    });
  }
}, 240_000);

test("bun test and bun test --aot: a test can try another platform's road", async () => {
  using dir = tempDir("aot-process-platform", files);
  for (const flags of [[], ["--aot"]]) {
    const { stderr, exitCode } = await run([bunExe(), "test", ...flags, "./platform.test.js"], String(dir), bunEnv);
    expect(stderr).toContain("1 pass");
    expect(stderr).toContain("0 fail");
    expect(exitCode).toBe(0);
  }
}, 120_000);
