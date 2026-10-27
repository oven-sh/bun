import { test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { findBuiltinTable } from "./generate";
import { programsOf, type Rejecting } from "./generated/built-ins-called-by-native-code-with-operands-they-reject";
import { generated } from "./generated/run-generated";

const title = "native code calls a built-in with an operand that it rejects";
const table = findBuiltinTable(bunExe());

function listed(tablePath: string): Rejecting[] {
  using folder = tempDir("aot-built-ins-that-reject", {});
  const list = join(String(folder), "list.json");
  Bun.spawnSync({
    cmd: [
      bunExe(),
      join(import.meta.dir, "generated/built-ins-called-by-native-code-with-operands-they-reject.ts"),
      tablePath,
      list,
    ],
    env: bunEnv,
    cwd: String(folder),
    stdout: "ignore",
    stderr: "ignore",
  });
  return JSON.parse(readFileSync(list, "utf8"));
}

if (table === undefined) test.skip(`${title}: there is no aot_builtin_table.json beside ${bunExe()}`, () => {});
else
  generated(
    title,
    programsOf(listed(table)).map(({ name, origin, text }) => ({
      name,
      isAlwaysRun:
        origin === "Engine" && /, (a symbol|an object whose conversion throws a number), promises$/.test(name),
      isOnlyCompiled: true as const,
      mayBeUnjudgeable: true as const,
      make: () => ({ file: "main.mjs", text }),
    })),
  );
