import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const firstBuiltinFunctionId = 0x10000;

/** Keys as in `builtinFunctionIds`. */
export const windowsOnlyBuiltinFunctions: ReadonlySet<string> = new Set(["ProcessObjectInternals.ts\twindowsEnv"]);

const listFunctionFiles = (directory: string) =>
  readdirSync(directory).filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts"));

/**
 * Where the text that every Bun holds of each file of built-in functions is, by the name of the file and in the order of the names. `directory` is src/js/builtins.
 * A file of functions that native code makes in compiled programs alone has a text in src/js/ahead-of-time/builtins and none in `directory`.
 */
export function builtinFunctionFiles(directory: string): Map<string, string> {
  const forCompiler = path.join(directory, "../ahead-of-time/builtins");
  const found = new Map(listFunctionFiles(forCompiler).map(file => [file, path.join(forCompiler, file)]));
  for (const file of listFunctionFiles(directory)) found.set(file, path.join(directory, file));
  return new Map([...found].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** By `<file>\t<function>`, as in `Fifo.ts\tcreateFIFO`. */
export function builtinFunctionIds(directory: string): Map<string, number> {
  const ids = new Map<string, number>();
  for (const [file, text] of builtinFunctionFiles(directory)) {
    const names = readFileSync(text, "utf8")
      .matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm)
      .map(match => match[1]);
    for (const name of [...names].sort()) {
      ids.set(`${file}\t${name}`, firstBuiltinFunctionId + ids.size);
    }
  }
  return ids;
}
