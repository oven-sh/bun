// Reads a `.bind.ts` file. Not in bindgen.ts, which generates when it is imported.

import assert from "node:assert";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SchemaFile } from "./bindgen-emit.ts";
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

/** `source` is `<crate>=<a.bind.ts>`. */
export const schemaFileOf = (source: string) => source.slice(source.indexOf("=") + 1);

export async function loadSchemaFile(source: string): Promise<SchemaFile> {
  const [file] = await loadSchemaFiles([source]);
  if (file instanceof Error) throw file;
  return file;
}

/** Each file, or why it cannot be read. They are imported together, and then read in order: the first to export a type owns it. */
export async function loadSchemaFiles(sources: readonly string[]): Promise<(SchemaFile | Error)[]> {
  const imports = await Promise.allSettled(sources.map(source => import(pathToFileURL(schemaFileOf(source)).href)));
  return imports.map((imported, i) => {
    if (imported.status === "rejected") {
      return new Error(`${schemaFileOf(sources[i])}: ${imported.reason.message}`, { cause: imported.reason });
    }
    try {
      return readSchemaFile(sources[i], imported.value);
    } catch (error) {
      return error as Error;
    }
  });
}

function readSchemaFile(source: string, exports: Record<string, unknown>): SchemaFile {
  const crate = source.slice(0, source.indexOf("="));
  const stem = path.basename(schemaFileOf(source), ".bind.ts");
  const origin: Origin = { stem, namespace: pascalCase(stem), rustModule: snakeCase(stem), crate };
  const result: SchemaFile = { origin, moduleDefinition: null, types: [], functions: [], namespaces: [] };
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
      // Re-exporting an import is fine; the first file to export a type owns it, and still does when it is read again.
      if ((value.origin && value.origin.stem !== stem) || result.types.includes(value)) continue;
      // As rustc's lint has it, digits can be separated: SHA512_256.
      assert(/^[A-Z][A-Za-z0-9]*(?:(?<=\d)_\d+)*$/.test(name), `${stem}.bind.ts: type names are PascalCase: ${name}`);
      value.name = name;
      value.origin = origin;
      result.types.push(value);
    } else {
      throw new TypeError(`${stem}.bind.ts: export ${name} is not a type, a function, a namespace or b.module()`);
    }
  }
  const names = new Set<string>();
  for (const { name } of [...result.functions, ...result.namespaces]) {
    assert(!names.has(name), `${stem}.bind.ts: two of its functions and namespaces are named ${name}`);
    names.add(name);
  }
  return result;
}

/** Dependencies before dependents. */
export function sortTypes(file: SchemaFile): void {
  const sorted: NamedType[] = [];
  const visit = (type: Type) => {
    if (type instanceof NamedType && sorted.includes(type)) return;
    for (const dependency of type.dependencies) visit(dependency);
    if (type instanceof NamedType && type.origin === file.origin) sorted.push(type);
  };
  file.types.forEach(visit);
  file.types = sorted;
}
