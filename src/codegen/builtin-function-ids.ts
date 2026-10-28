import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const firstBuiltinFunctionId = 0x10000;

/** Keys as in `builtinFunctionIds`. */
export const windowsOnlyBuiltinFunctions: ReadonlySet<string> = new Set(["ProcessObjectInternals.ts\twindowsEnv"]);

/** By `<file>\t<function>`, as in `Fifo.ts\tcreateFIFO`. */
export function builtinFunctionIds(directory: string): Map<string, number> {
  const ids = new Map<string, number>();
  const files = readdirSync(directory)
    .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts"))
    .sort();
  for (const file of files) {
    const names = readFileSync(path.join(directory, file), "utf8")
      .matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm)
      .map(match => match[1]);
    for (const name of [...names].sort()) {
      ids.set(`${file}\t${name}`, firstBuiltinFunctionId + ids.size);
    }
  }
  return ids;
}
