import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const folder = join(import.meta.dir, "programs", "modules");
const programs = ["bun-wrap-computed-name", "bun-wrap-computed-name-alone", "bun-wrap-computed-name-required"];

test.concurrent.each(programs)(
  "bun run --aot %s",
  async name => {
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "run", "--debug-aot", join(folder, name + ".js")],
      undefined,
      { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
    );
    const diagnostics = stderr.split("\n").filter(line => /^(warn|error)\b/.test(line));
    expect({
      stdout,
      otherDiagnostics: diagnostics.filter(
        line => !line.startsWith("warn: TS100064: this import path isn't a constant."),
      ),
      exitCode,
    }).toEqual({
      stdout: readFileSync(join(folder, name + ".expected.txt"), "utf8"),
      otherDiagnostics: [],
      exitCode: 0,
    });
    expect(diagnostics).not.toBeEmpty();
  },
  120_000,
);
