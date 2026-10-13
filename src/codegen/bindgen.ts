#!/usr/bin/env bun
// Usage: bindgen.ts --sources=<a.bind.ts,b.bind.ts,...> --codegen-path=<dir> --types-path=<dir>
//
// Writes, and scripts/build/codegen.ts declares:
//   <codegen>/Generated<Namespace>.{h,cpp}     per source
//   <codegen>/GeneratedBindings+Tables.h, GeneratedBindings+Counts.h
//   <codegen>/generated_bindgen_<crate>.rs     per crate that owns a source
//   <types>/Bindgen.d.ts

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  analyze,
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
  type Origin,
  pascalCase,
  snakeCase,
  type Type,
} from "./bindgen-lib-internal.ts";
import { argParse, writeIfNotChanged } from "./helpers.ts";

/** The Cargo package whose directory contains `file`. */
function crateOf(file: string): string {
  for (let dir = path.dirname(file); dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const manifest = path.join(dir, "Cargo.toml");
    if (!fs.existsSync(manifest)) continue;
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(manifest, "utf8"));
    if (name) return name[1];
  }
  throw new Error(`${file} is not inside a Cargo package`);
}

async function load(file: string): Promise<SchemaFile> {
  const stem = path.basename(file, ".bind.ts");
  const origin: Origin = {
    file,
    stem,
    namespace: pascalCase(stem),
    rustModule: snakeCase(stem),
    crate: crateOf(file),
  };
  const result: SchemaFile = { origin, moduleDefinition: null, types: [], functions: [] };
  for (const [name, value] of Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>)) {
    if (value instanceof ModuleDefinition) {
      assert(name === "default", `${stem}.bind.ts: b.module() is the default export`);
      result.moduleDefinition = value;
    } else if (value instanceof FunctionDefinition) {
      value.name = name;
      value.origin = origin;
      result.functions.push(value);
    } else if (value instanceof NamedType) {
      // Re-exporting an import is fine; the first file to export a type owns it.
      if (value.origin) continue;
      assert(/^[A-Z][A-Za-z0-9]*$/.test(name), `${stem}.bind.ts: type names are PascalCase: ${name}`);
      value.name = name;
      value.origin = origin;
      result.types.push(value);
    } else {
      throw new TypeError(`${stem}.bind.ts: export ${name} is not a type, a function or b.module()`);
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

const args = argParse(["sources", "codegen-path", "types-path"]);
const codegenPath: string = args["codegen-path"];
const sources = (args.sources as string)
  .split(",")
  .filter(source => source.length > 0)
  .sort();

const files = await Promise.all(sources.map(load));
files.forEach(sortTypes);
const names = files.flatMap(file => file.types.map(type => type.name));
assert(new Set(names).size === names.length, "two .bind.ts files export a type with the same name");
const tables = analyze(files);

for (const file of files) {
  writeIfNotChanged(path.join(codegenPath, `Generated${file.origin.namespace}.h`), cppHeader(file));
  writeIfNotChanged(path.join(codegenPath, `Generated${file.origin.namespace}.cpp`), cppSource(file));
}
writeIfNotChanged(path.join(codegenPath, "GeneratedBindings+Tables.h"), cppTables(tables));
writeIfNotChanged(path.join(codegenPath, "GeneratedBindings+Counts.h"), cppCounts(tables));
for (const [crate, crateFiles] of Map.groupBy(files, file => file.origin.crate)) {
  writeIfNotChanged(path.join(codegenPath, `generated_bindgen_${crate}.rs`), rustForCrate(crateFiles));
}
writeIfNotChanged(path.join(args["types-path"], "Bindgen.d.ts"), dts(files));
