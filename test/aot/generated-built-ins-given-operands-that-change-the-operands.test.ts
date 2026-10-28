import { test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { findBuiltinTable } from "./generate";
import { generated } from "./generated/run-generated";

const title = "a built-in is given an operand whose code changes the operands of the call";
const table = findBuiltinTable(bunExe());
const generator = join(import.meta.dir, "generated/built-ins-given-operands-that-change-the-operands.ts");
// The generator calls each function once, to learn which code of an operand it runs, in a process of its own.
const run = (...passed: string[]) =>
  Bun.spawnSync({
    cmd: [bunExe(), generator, ...passed],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  }).stdout.toString();

if (table === undefined) test.skip(`${title}: there is no aot_builtin_table.json beside ${bunExe()}`, () => {});
else
  generated(
    title,
    (JSON.parse(run(table, "--names")) as string[]).map((name, index) => ({
      name,
      isAlwaysRun: false,
      isOnlyCompiled: true as const,
      mayBeUnjudgeable: true as const,
      flags: index % 3 === 0 ? ["--aot-validate"] : index % 3 === 1 ? ["--aot-heat=everything-is-hot"] : [],
      make: () => ({ file: "main.mjs", text: run(table, "--text", name) }),
    })),
  );
