#!/usr/bin/env bun
// Usage: bindgen.ts --sources=<crate>=<a.bind.ts>,.. --types-only=<b.bind.ts>,.. --codegen-path=<dir> --types-path=<dir> (emitBindgen in scripts/build/codegen.ts)

import assert from "node:assert";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
import {
  FunctionDefinition,
  ModuleDefinition,
  NamedType,
  NamespaceDefinition,
  type Origin,
  pascalCase,
  snakeCase,
  type Type,
} from "./bindgen-lib-internal.ts";
import { argParse, writeIfNotChanged } from "./helpers.ts";

async function load(source: string): Promise<SchemaFile> {
  const crate = source.slice(0, source.indexOf("="));
  const file = source.slice(crate.length + 1);
  const stem = path.basename(file, ".bind.ts");
  const origin: Origin = { stem, namespace: pascalCase(stem), rustModule: snakeCase(stem), crate };
  const result: SchemaFile = { origin, moduleDefinition: null, types: [], functions: [], namespaces: [] };
  const exports: Record<string, unknown> = await import(pathToFileURL(file).href).catch(error => {
    throw new Error(`${file}: ${error.message}`, { cause: error });
  });
  for (const [name, value] of Object.entries(exports)) {
    if (value instanceof ModuleDefinition) {
      assert(name === "default", `${stem}.bind.ts: b.module() is the default export`);
      result.moduleDefinition = value;
    } else if (value instanceof FunctionDefinition) {
      value.name = name;
      value.origin = origin;
      result.functions.push(value);
    } else if (value instanceof NamespaceDefinition) {
      value.name = name;
      for (const fn of value.functions) {
        fn.origin = origin;
        result.functions.push(fn);
      }
      result.namespaces.push(value);
    } else if (value instanceof NamedType) {
      // Re-exporting an import is fine; the first file to export a type owns it.
      if (value.origin) continue;
      // As rustc's lint has it, digits can be separated: SHA512_256.
      assert(/^[A-Z][A-Za-z0-9]*(?:(?<=\d)_\d+)*$/.test(name), `${stem}.bind.ts: type names are PascalCase: ${name}`);
      value.name = name;
      value.origin = origin;
      result.types.push(value);
    } else {
      throw new TypeError(`${stem}.bind.ts: export ${name} is not a type, a function, a namespace or b.module()`);
    }
  }
  return result;
}

/** Dependencies before dependents. */
function sortTypes(file: SchemaFile): void {
  const sorted: NamedType[] = [];
  const visit = (type: Type) => {
    if (type instanceof NamedType && sorted.includes(type)) return;
    for (const dependency of type.dependencies) visit(dependency);
    if (type instanceof NamedType && type.origin === file.origin) sorted.push(type);
  };
  file.types.forEach(visit);
  file.types = sorted;
}

const args = argParse(["sources", "types-only", "codegen-path", "types-path"]);
const codegenPath: string = args["codegen-path"];
const sources = (args.sources as string)
  .split(",")
  .filter(source => source.length > 0)
  .sort();

const allFiles: SchemaFile[] = [];
for (const source of sources) allFiles.push(await load(source));
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
}
const tables = analyze(files);

/** What a schema is found to get wrong only as text is made of it. */
function emit<T>(file: SchemaFile, text: (file: SchemaFile) => T): T {
  try {
    return text(file);
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
