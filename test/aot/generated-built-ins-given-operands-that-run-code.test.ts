import { test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { findBuiltinTable } from "./generate";
import {
  families,
  fileThatDescribes,
  programsOf,
  type Callable,
} from "./generated/built-ins-given-operands-that-run-code";
import { generated } from "./generated/run-generated";

const title = "a built-in is given operands that run code of the program";
const table = findBuiltinTable(bunExe());
const files = {
  [fileThatDescribes]: readFileSync(join(import.meta.dir, "builtins/differential", fileThatDescribes), "utf8"),
};

function listed(tablePath: string): Callable[] {
  using folder = tempDir("aot-built-ins-listed", {});
  const list = join(String(folder), "list.json");
  const run = (...command: string[]) =>
    Bun.spawnSync({ cmd: [bunExe(), ...command], env: bunEnv, cwd: String(folder), stdout: "pipe", stderr: "inherit" });
  run(join(import.meta.dir, "fuzz/fuzzilli/list-builtins.ts"), tablePath, list);
  return JSON.parse(
    run(join(import.meta.dir, "generated/built-ins-given-operands-that-run-code.ts"), list).stdout.toString(),
  );
}

if (table === undefined) test.skip(`${title}: there is no aot_builtin_table.json beside ${bunExe()}`, () => {});
else
  generated(
    title,
    listed(table).flatMap(callable =>
      families.map(family => ({
        name: `${callable.label}, ${family}`,
        isAlwaysRun: false,
        isOnlyCompiled: true as const,
        mayBeUnjudgeable: true as const,
        flags: ["--aot-validate"],
        make: () => ({ file: "main.js", text: programsOf([callable], family, Infinity)[0] ?? "", files }),
      })),
    ),
  );
