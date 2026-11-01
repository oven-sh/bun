import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// The process that builds a layer is handed the flags as they were typed. It started in the directory that `--cwd` had already led
// to, followed the flag again from there, and no test ran: `Could not change directory to "sub"`.
test("a run in layers follows --cwd once", async () => {
  using dir = tempDir("aot-layers-and-cwd", {
    "package.json": JSON.stringify({ name: "outer", version: "1.0.0", type: "module" }),
    "outer.test.ts": `import { test } from "bun:test";\ntest("outside the folder", () => {\n  throw new Error("not asked for");\n});\n`,
    "sub/lib.ts": `export const folder = () => process.cwd().split(/[\\\\/]/).pop();\n`,
    "sub/nested.test.ts": `import { test, expect } from "bun:test";\nimport { folder } from "./lib";\ntest("in a folder", () => {\n  expect(folder()).toBe("sub");\n  console.log("ran in", folder());\n});\n`,
    "sub/deeper/sub/other.test.ts": `import { test } from "bun:test";\ntest("in a folder of the same name", () => {\n  console.log("ran in", process.cwd().split(/[\\\\/]/).slice(-3).join("/"));\n});\n`,
  });
  async function report(...flags: string[]) {
    // The word changes nothing: with it a compiled run says how it is built.
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
    if (flags.includes("--aot")) expectLayers(stderr);
    return {
      seen: (stdout + stderr)
        .split("\n")
        .filter(line => line.startsWith("ran in"))
        .sort(),
      results: [...stderr.matchAll(/^\((pass|fail|skip)\) (.+?)(?: \[.*\])?$/gm)]
        .map(match => `${match[1]} ${match[2]}`)
        .sort(),
      ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0],
      exitCode,
    };
  }
  // No build fits into this, so the run is built in layers.
  const layers = ["--aot", "--aot-memory-limit=1KB"];
  for (const cwd of [
    ["--cwd=sub"],
    ["--cwd", "sub"],
    ["--cwd=./sub/"],
    ["--cwd=" + String(dir) + "/sub"],
    ["--cwd=sub/deeper/sub"],
  ]) {
    const plain = await report("--parallel=2", ...cwd);
    expect(plain.exitCode).toBe(0);
    expect(plain.seen.length).toBeGreaterThan(0);
    expect({ cwd, ...(await report("--parallel=2", ...layers, ...cwd)) }).toEqual({ cwd, ...plain });
  }
}, 240_000);
