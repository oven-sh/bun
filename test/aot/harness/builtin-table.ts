import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The table of built-ins that the build of `bun` wrote. It lies beside that Bun, or AOT_BUILTIN_TABLE names it. */
export function findBuiltinTable(bun: string): string | undefined {
  const name = "aot_builtin_table.json";
  return (
    process.env.AOT_BUILTIN_TABLE ?? [join(dirname(bun), name), join(dirname(bun), "codegen", name)].find(existsSync)
  );
}
