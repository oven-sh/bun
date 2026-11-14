#!/usr/bin/env bun
// Usage: bindgen.ts --sources=<crate>=<a.bind.ts>,.. --types-only=<b.bind.ts>,.. --codegen-path=<dir> --types-path=<dir> [--engine-directory=<Source/JavaScriptCore/aot> --builtin-uses=<builtin-uses.json>] (emitBindgen in scripts/build/codegen.ts)

import assert from "node:assert";
import path from "node:path";
import { readBuiltinUses } from "../../scripts/build/trim/builtin-uses.ts";
import {
  analyze,
  cppClasses,
  cppCounts,
  cppHeader,
  cppSource,
  cppTables,
  dts,
  rustForCrate,
  type SchemaFile,
} from "./bindgen-emit.ts";
import { loadSchemaFile, sortTypes } from "./bindgen-load.ts";
import { Guards } from "./builtins/guards.ts";
import { argParse, writeIfNotChanged } from "./helpers.ts";

const args = argParse(["sources", "types-only", "codegen-path", "types-path", "engine-directory", "builtin-uses"]);
const codegenPath: string = args["codegen-path"];
const sources = (args.sources as string)
  .split(",")
  .filter(source => source.length > 0)
  .sort();
const builtinUses: string | undefined = args["builtin-uses"];
/** Without the table of built-ins nothing is guarded, and nothing compiles the C++. */
const guards = new Guards(builtinUses ? readBuiltinUses(builtinUses) : { entries: [] });

const allFiles: SchemaFile[] = [];
for (const source of sources) allFiles.push(await loadSchemaFile(source));
allFiles.forEach(sortTypes);
const typesOnly = ((args["types-only"] as string | undefined) ?? "").split(",");
/** What this build compiles. The types describe every schema. */
const files = allFiles.filter(file => !typesOnly.includes(`${file.origin.stem}.bind.ts`));
const owners = new Map<string, string>();
for (const file of files) {
  for (const { name } of file.types) {
    assert(!owners.has(name), `${owners.get(name)}.bind.ts and ${file.origin.stem}.bind.ts both export a type ${name}`);
    owners.set(name, file.origin.stem);
  }
  for (const { exportName } of file.functions) {
    if (!exportName) continue;
    assert(
      !owners.has(exportName),
      `export: ${exportName} is in ${owners.get(exportName)}.bind.ts and ${file.origin.stem}.bind.ts`,
    );
    owners.set(exportName, file.origin.stem);
  }
}
const tables = analyze(files);

/** What a schema is found to get wrong only as text is made of it. */
function emit<T>(file: SchemaFile, text: (file: SchemaFile, guards: Guards) => T): T {
  try {
    return text(file, guards);
  } catch (error) {
    throw new Error(`${file.origin.stem}.bind.ts: ${(error as Error).message}`, { cause: error });
  }
}
for (const file of files) {
  writeIfNotChanged(path.join(codegenPath, `Generated${file.origin.namespace}.h`), emit(file, cppHeader));
  writeIfNotChanged(path.join(codegenPath, `Generated${file.origin.namespace}.cpp`), emit(file, cppSource));
}
writeIfNotChanged(path.join(codegenPath, "GeneratedBindings+Tables.h"), cppTables(tables));
writeIfNotChanged(path.join(codegenPath, "GeneratedBindings+Counts.h"), cppCounts(tables));
writeIfNotChanged(path.join(codegenPath, "GeneratedBindings+Classes.h"), cppClasses(tables));
for (const [crate, crateFiles] of Map.groupBy(files, file => file.origin.crate)) {
  writeIfNotChanged(path.join(codegenPath, `generated_bindgen_${crate}.rs`), rustForCrate(crateFiles));
}
writeIfNotChanged(path.join(args["types-path"], "Bindgen.d.ts"), dts(allFiles));
