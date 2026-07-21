import { pathToFileURL } from "node:url";
import * as helpers from "../helpers";
import { NamedType, Type } from "./internal/base";

const USAGE = `\
Usage: script.ts [options]

Options (all required):
  --command=<command>    Command to run (see below)
  --sources=<sources>    Comma-separated list of *.bindv2.ts files
  --codegen-path=<path>  Path to build/*/codegen

Commands:
  list-outputs  List files that will be generated, separated by semicolons
  generate      Generate all files
`;

let codegenPath: string;
let sources: string[];

async function getNamedExports(): Promise<NamedType[]> {
  const all: NamedType[] = [];
  for (const path of sources) {
    const exports = await import(pathToFileURL(path).href);
    all.push(...(Object.values(exports).filter(v => v instanceof NamedType) as NamedType[]));
  }
  return all;
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

async function listOutputs(): Promise<void> {
  const outputs: string[] = [];
  for (const type of await getNamedExports()) {
    if (type.hasCppSource) outputs.push(cppSourcePath(type));
  }
  process.stdout.write(outputs.join(";"));
}

async function generate(): Promise<void> {
  const names = new Set<string>();

  const namedExports = await getNamedExports();
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
    if (cppHeader) {
      helpers.writeIfNotChanged(cppHeaderPath(type), cppHeader);
    }
    if (cppSource) {
      helpers.writeIfNotChanged(cppSourcePath(type), cppSource);
    }
  }
}

async function main(): Promise<void> {
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
      await listOutputs();
      break;
    case "generate":
      await generate();
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

await main();
