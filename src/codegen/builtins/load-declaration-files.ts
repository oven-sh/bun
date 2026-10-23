import { existsSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  DeclarationFile,
  Problems,
  type Declaration,
  type Proof,
  type Source,
  type SourcedDeclaration,
} from "./declarations.ts";
import * as lib from "./lib.ts";
import { compareBytes } from "./paths.ts";
import { readCMakeList } from "./support.ts";
import type { Origin } from "./vocabulary.ts";

export const libraryModuleName = "bun-builtins-table";

const declarationFileSuffix = ".builtins.ts";
const engineDeclarationDirectory = "aot/builtins";
const engineListFile = "aot/builtins/AOTBuiltinTable.cmake";
const engineListName = "JavaScriptCore_AOT_BUILTIN_TABLE_DECLARATIONS";
const hostDeclarationDirectory = "src/codegen/builtins/host";

let isLibraryModuleRegistered = false;

export function registerLibraryModule(): void {
  if (isLibraryModuleRegistered) return;
  isLibraryModuleRegistered = true;
  if (typeof Bun !== "undefined") {
    Bun.plugin({
      name: libraryModuleName,
      setup(build) {
        build.module(libraryModuleName, () => ({ exports: lib, loader: "object" }));
      },
    });
    return;
  }
  const libraryUrl = new URL("./lib.ts", import.meta.url).href;
  process.getBuiltinModule("node:module").registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === libraryModuleName ? { url: libraryUrl, shortCircuit: true } : nextResolve(specifier, context),
  });
}

const declarationFileNamesIn = (directory: string): string[] =>
  readdirSync(directory)
    .filter(name => name.endsWith(declarationFileSuffix))
    .sort(compareBytes);

const sourceOfFile = (file: string, origin: Origin): Source => ({ file, line: null, origin, proof: "Structure" });

export function engineDeclarationFiles(javaScriptCore: string): string[] {
  const listed = readCMakeList(resolve(javaScriptCore, engineListFile), engineListName);
  const problems = new Problems();
  for (const file of listed) {
    if (existsSync(resolve(javaScriptCore, file))) continue;
    problems.add(sourceOfFile(engineListFile, "Engine"), `${engineListName} lists ${file}, which does not exist`);
  }
  const listedFiles = new Set(listed);
  for (const name of declarationFileNamesIn(resolve(javaScriptCore, engineDeclarationDirectory))) {
    const file = `${engineDeclarationDirectory}/${name}`;
    if (listedFiles.has(file)) continue;
    problems.add(sourceOfFile(file, "Engine"), `missing from ${engineListName} in ${engineListFile}`);
  }
  problems.throwIfAny();
  return listed.map(file => resolve(javaScriptCore, file));
}

export function hostDeclarationFiles(bunRoot: string): string[] {
  const directory = resolve(bunRoot, hostDeclarationDirectory);
  return declarationFileNamesIn(directory).map(name => resolve(directory, name));
}

const proofOf = (declaration: Declaration): Proof =>
  declaration.declares === "Member" && declaration.signatures.length > 0 ? "HandWritten" : "Structure";

export async function loadDeclarationFiles(
  files: readonly string[],
  origin: Origin,
  root: string,
): Promise<SourcedDeclaration[]> {
  registerLibraryModule();
  const problems = new Problems();
  const sourced: SourcedDeclaration[] = [];
  for (const path of files) {
    const source = sourceOfFile(relative(root, path).split(sep).join("/"), origin);
    const exported: Readonly<Record<string, unknown>> = await import(pathToFileURL(path).href);
    const otherExports = Object.keys(exported).filter(name => name !== "default");
    if (otherExports.length > 0) {
      problems.add(source, `a declaration file has a default export only: remove ${otherExports.join(", ")}`);
    }
    if (!(exported.default instanceof DeclarationFile)) {
      problems.add(source, "the default export must be the result of b.declarations()");
      continue;
    }
    for (const declaration of exported.default.declarations) {
      sourced.push({ declaration, source: { ...source, proof: proofOf(declaration) } });
    }
  }
  problems.throwIfAny();
  return sourced;
}
