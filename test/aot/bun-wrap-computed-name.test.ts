import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const folder = join(import.meta.dir, "programs", "modules");
const programs = ["bun-wrap-computed-name"];

test.concurrent.each(programs)(
  "bun run --aot %s",
  async name => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "run", "--debug-aot", join(folder, name + ".js")],
      undefined,
      { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
    );
    const diagnostics = stderr.split("\n").filter(line => /^(warn|error)\b/.test(line));
    expect({ stdout, diagnostics, exitCode }).toEqual({
      stdout: readFileSync(join(folder, name + ".expected.txt"), "utf8"),
      diagnostics: [],
      exitCode: 0,
    });
  },
  120_000,
);
