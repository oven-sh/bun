#!/usr/bin/env bun
import * as helpers from "../helpers";
import { NamedType, Type } from "./internal/base";

const USAGE = `\
Usage: script.ts [options]

Options (all required):
  --command=<command>    Command to run (see below)
  --sources=<sources>    Comma-separated list of *.bindv2.ts files
  --codegen-path=<path>  Path to build/*/codegen

Commands:
  list-outputs  List files that will be generated, separated by semicolons (for CMake)
  generate      Generate all files
`;

let codegenPath: string;
let sources: string[];

function getNamedExports(): NamedType[] {
  return sources.flatMap(path => {
    const exports = import.meta.require(path);
    return Object.values(exports).filter(v => v instanceof NamedType);
  });
}

function getNamedDependencies(type: Type, result: Set<NamedType>): void {
  for (const dependency of type.dependencies) {
    if (dependency instanceof NamedType) {
      result.add(dependency);
    }
    getNamedDependencies(dependency, result);
  }
}

function cppHeaderPath(type: NamedType): string {
  return `${codegenPath}/Generated${type.name}.h`;
}

function cppSourcePath(type: NamedType): string {
  return `${codegenPath}/Generated${type.name}.cpp`;
}

function zigSourcePath(typeOrNamespace: NamedType | string): string {
  let ns: string;
  if (typeof typeOrNamespace === "string") {
    ns = typeOrNamespace;
  } else {
    ns = toZigNamespace(typeOrNamespace.name);
  }
  return `${codegenPath}/bindgen_generated/${ns}.zig`;
}

function toZigNamespace(name: string): string {
  const result = name
    .replace(/([^A-Z_])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
  if (result === name) {
    return result + "_namespace";
  }
  return result;
}

function listOutputs(): void {
  const outputs: string[] = [`${codegenPath}/bindgen_generated.zig`];
  for (const type of getNamedExports()) {
    if (type.hasCppSource) outputs.push(cppSourcePath(type));
    if (type.hasZigSource) outputs.push(zigSourcePath(type));
  }
  process.stdout.write(outputs.join(";"));
}

function generate(): void {
  const names = new Set<string>();
  const zigRoot: string[] = [];
  const zigRootInternal: string[] = [];

  const namedExports = getNamedExports();
  {
    const namedDependencies = new Set<NamedType>();
    for (const type of namedExports) {
      getNamedDependencies(type, namedDependencies);
    }
    const namedExportsSet = new Set(namedExports);
    for (const type of namedDependencies) {
      if (!namedExportsSet.has(type)) {
        console.error(`error: named type must be exported: ${type.name}`);
        process.exit(1);
      }
    }
    const namedTypeNames = new Set<string>();
    for (const type of namedExports) {
      if (namedTypeNames.size == namedTypeNames.add(type.name).size) {
        console.error(`error: multiple types with same name: ${type.name}`);
        process.exit(1);
      }
    }
  }

  for (const type of namedExports) {
    const zigNamespace = toZigNamespace(type.name);
    const size = names.size;
    names.add(type.name);
    names.add(zigNamespace);
    if (names.size !== size + 2) {
      console.error(`error: duplicate name: ${type.name}`);
      process.exit(1);
    }

    const cppHeader = type.cppHeader;
    const cppSource = type.cppSource;
    const zigSource = type.zigSource;
    if (cppHeader) {
      helpers.writeIfNotChanged(cppHeaderPath(type), cppHeader);
    }
    if (cppSource) {
      helpers.writeIfNotChanged(cppSourcePath(type), cppSource);
    }
    if (zigSource) {
      zigRoot.push(
        `pub const ${zigNamespace} = @import("./bindgen_generated/${zigNamespace}.zig");`,
        `pub const ${type.name} = ${zigNamespace}.${type.name};`,
        "",
      );
      zigRootInternal.push(`pub const ${type.name} = ${zigNamespace}.Bindgen${type.name};`);
      helpers.writeIfNotChanged(zigSourcePath(zigNamespace), zigSource);
    }
  }

  helpers.writeIfNotChanged(
    `${codegenPath}/bindgen_generated.zig`,
    [
      ...zigRoot,
      `pub const internal = struct {`,
      ...zigRootInternal.map(s => "    " + s),
      `};`,
      "",
    ].join("\n"),
  );
}

function main(): void {
  const args = helpers.argParse(["command", "codegen-path", "sources", "help"]);
  if (Object.keys(args).length === 0) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  const { command, "codegen-path": codegenPathArg, sources: sourcesArg, help } = args;
  if (help != null) {
    process.stdout.write(USAGE);
    process.exit(0);
  }

  if (typeof codegenPathArg !== "string") {
    console.error("error: missing --codegen-path");
    process.exit(1);
  }
  codegenPath = codegenPathArg;

  if (typeof sourcesArg !== "string") {
    console.error("error: missing --sources");
    process.exit(1);
  }
  sources = sourcesArg.split(",").filter(x => x);

  switch (command) {
    case "list-outputs":
      listOutputs();
      break;
    case "generate":
      generate();
      break;
    default:
      if (typeof command === "string") {
        console.error("error: unknown command: " + command);
      } else {
        console.error("error: missing --command");
      }
      process.exit(1);
  }
}

main();
