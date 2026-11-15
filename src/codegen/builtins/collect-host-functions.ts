// The functions of Bun that the compiler knows by a number: what its front end compiles for every program, and the built-ins of src/js.
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { windowsOnlyBuiltinFunctions } from "../builtin-function-ids.ts";
import {
  declarationOf,
  findExportedFunctions,
  keyOf,
  sourceOf,
  type FoundFunction,
} from "./collect-runtime-functions.ts";
import type { Problems, SourcedDeclaration } from "./declarations.ts";
import { compareBytes } from "./paths.ts";
import { targetPlatforms, type FunctionRef, type TargetPlatform } from "./vocabulary.ts";

const preludeDirectory = "src/aot/prelude";
const hostFunctionDirectory = "src/js/builtins";

const windowsOnly: readonly TargetPlatform[] = ["Windows"];

export function collectPreludeFunctions(bunRoot: string): FoundFunction[] {
  return readdirSync(join(bunRoot, preludeDirectory))
    .filter(name => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort(compareBytes)
    .flatMap(name =>
      findExportedFunctions(bunRoot, `${preludeDirectory}/${name}`, `prelude/${basename(name, ".ts")}`, "Host"),
    );
}

function findExcludedHostFunctions(
  hostFunctions: readonly FunctionRef[],
  declared: readonly SourcedDeclaration[],
  problems: Problems,
): Set<string> {
  const hostKeys = new Set(hostFunctions.map(keyOf));
  const excludedKeys = new Set<string>();
  for (const { declaration, source } of declared) {
    if (declaration.declares !== "ExcludedFunction" || source.origin !== "Host") continue;
    const { file, name } = declaration.function;
    if (!hostKeys.has(keyOf(declaration.function))) problems.add(source, `src/js/${file}.ts has no function ${name}`);
    excludedKeys.add(keyOf(declaration.function));
  }
  return excludedKeys;
}

export function collectHostFunctions(
  hostFunctionIds: ReadonlyMap<string, number>,
  declared: readonly SourcedDeclaration[],
  problems: Problems,
): SourcedDeclaration[] {
  const hostFunctions = Array.from(hostFunctionIds, ([key, id]) => {
    const [fileName, name] = key.split("\t");
    const found = {
      function: { file: `builtins/${basename(fileName, ".ts")}`, name },
      exportName: name,
      source: sourceOf(`${hostFunctionDirectory}/${fileName}`, "Host"),
    };
    return { found, id, platforms: windowsOnlyBuiltinFunctions.has(key) ? windowsOnly : targetPlatforms };
  });
  const excludedKeys = findExcludedHostFunctions(
    hostFunctions.map(({ found }) => found.function),
    declared,
    problems,
  );
  return hostFunctions
    .filter(({ found }) => !excludedKeys.has(keyOf(found.function)))
    .map(({ found, id, platforms }) => declarationOf(found, id, "HostBuiltin", null, platforms));
}
