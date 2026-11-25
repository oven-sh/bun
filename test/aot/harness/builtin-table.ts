import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The table of built-ins that the build of `bun` wrote. It lies beside that Bun, or AOT_BUILTIN_TABLE names it. */
export function findBuiltinTable(bun: string): string | undefined {
  const name = "aot_builtin_table.json";
  return (
    process.env.AOT_BUILTIN_TABLE ?? [join(dirname(bun), name), join(dirname(bun), "codegen", name)].find(existsSync)
  );
}

/** For a test that reads the table. Every build writes one, so a test that does not find it has not run, and fails. */
export function builtinTableOf(bun: string): string {
  const table = findBuiltinTable(bun);
  if (table === undefined)
    throw new Error(
      `NOT RUN: it wants AOT_BUILTIN_TABLE, or aot_builtin_table.json beside ${bun} or in the folder codegen beside it`,
    );
  return table;
}
