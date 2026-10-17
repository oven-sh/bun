import { expect } from "bun:test";
import { test } from "./supported";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

const folder = join(import.meta.dir, "programs", "modules");
const programs = ["bun-wrap-computed-name", "bun-wrap-computed-name-alone", "bun-wrap-computed-name-required"];

test.concurrent.each(programs)(
  "bun run --aot %s",
  async name => {
    await using ran = Bun.spawn({
      cmd: [bunExe(), "run", "--debug-aot", join(folder, name + ".js")],
      env: { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: readFileSync(join(folder, name + ".expected.txt"), "utf8"), stderr: "", exitCode: 0 });
  },
  120_000,
);
