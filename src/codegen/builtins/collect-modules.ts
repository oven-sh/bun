import { readFileSync } from "node:fs";
import path from "node:path";
import { helperModules, moduleList, nativeStartIndex, specifierOf } from "../builtins-manifest-model.ts";
import { idToEnumName } from "../internal-module-registry-scanner.ts";
import {
  GeneratorError,
  leftOutOf,
  type Declaration,
  type MemberDeclaration,
  type ModuleExportDeclaration,
  type ModuleExportHolder,
  type Problems,
  type Source,
  type SourcedDeclaration,
} from "./declarations.ts";
import { parseOwnProperties } from "./own-properties.ts";
import { compareBytes, memberPathOf } from "./paths.ts";
import { targetPlatforms, type BuiltinPath, type TargetPlatform } from "./vocabulary.ts";

export interface RuntimeModuleSource {
  specifier: string;
  registryId: number;
  registryField: string | null;
  hasSource: boolean;
  isEsModule: boolean;
}

export interface ListedExport {
  name: string;
  holder: ModuleExportHolder;
}

export interface ListedModule {
  isFunction: boolean;
  exports: ListedExport[];
}

interface ExportLists {
  listed: ReadonlyMap<string, ListedModule>;
  absentOnWindows: ReadonlyMap<string, ListedModule>;
}

const objectModules: ReadonlyMap<string, BuiltinPath> = new Map([
  ["abort-controller", "AbortController"],
  ["bun", "Bun"],
  ["node:process", "process"],
]);
const openNamespaces: ReadonlySet<string> = new Set(["bun"]);
const partiallyListedModules: ReadonlySet<string> = new Set(["node:constants"]);
const observedPlatforms: readonly TargetPlatform[] = ["Darwin", "Linux", "Windows"];
const runtimeDecidedModules: ReadonlySet<string> = new Set(["node:process"]);
// Listed among the importable modules, and answered only under --expose-internals.
const modulesOfBunsOwnTests: ReadonlySet<string> = new Set(["internal/test/binding"]);
const defaultExport = "default";
const writtenHolders = { property: "Property", namespace: "Namespace" } as const;
const functionMark = "=function";

const exportsFile = "src/codegen/builtins/data/module-exports.txt";
const absentOnWindowsFile = "src/codegen/builtins/data/module-exports-absent-on-windows.txt";
export const ownPropertiesFile = "src/codegen/builtins/data/own-properties.txt";
const importableModulesFile = "src/resolve_builtins/HardcodedModule.rs";
const importableSpecifierPattern = /#\[strum\(serialize = "([^"]+)"\)\]/g;

const sourceAt = (file: string, line: number | null): Source => ({ file, line, origin: "Host", proof: "Structure" });

const withSource = (declarations: readonly Declaration[], source: Source): SourcedDeclaration[] =>
  declarations.map(declaration => ({ declaration, source }));

function parseOrReport<T>(problems: Problems, parse: () => T): T | null {
  try {
    return parse();
  } catch (error) {
    if (!(error instanceof GeneratorError)) throw error;
    problems.add(null, error.message);
    return null;
  }
}

export function runtimeModuleSources(): RuntimeModuleSource[] {
  const sources = moduleList.map((entry, registryId): RuntimeModuleSource => {
    const hasSource = registryId < nativeStartIndex;
    return {
      specifier: (hasSource ? specifierOf(entry) : entry) ?? entry,
      registryId,
      registryField: idToEnumName(entry),
      hasSource,
      isEsModule: false,
    };
  });
  for (const helper of helperModules) {
    sources.push({
      specifier: helper.specifier ?? path.parse(helper.path).name,
      registryId: helper.id,
      registryField: null,
      hasSource: true,
      isEsModule: helper.isEsModule,
    });
  }
  return sources;
}

const unwrittenHolderOf = (name: string): ModuleExportHolder => (name === defaultExport ? "ModuleObject" : "Property");

function parseListedExport(word: string): ListedExport | null {
  const [name, written, ...rest] = word.split("=");
  if (written === undefined) return { name, holder: unwrittenHolderOf(name) };
  if (rest.length > 0 || !Object.hasOwn(writtenHolders, written)) return null;
  const holder = writtenHolders[written as keyof typeof writtenHolders];
  return holder === unwrittenHolderOf(name) ? null : { name, holder };
}

function formatListedExport({ name, holder }: ListedExport): string {
  if (holder === unwrittenHolderOf(name)) return name;
  const written = Object.entries(writtenHolders).find(([, candidate]) => candidate === holder);
  if (written === undefined) throw new GeneratorError(`${name}: only ${defaultExport} holds the object of its module`);
  return `${name}=${written[0]}`;
}

export function formatModuleExports(modules: ReadonlyMap<string, ListedModule>): string {
  return Array.from(modules, ([specifier, { isFunction, exports }]) => {
    const words = [specifier + (isFunction ? functionMark : ""), ...exports.map(formatListedExport)];
    return `${words.join(" ")}\n`;
  }).join("");
}

export function parseModuleExports(text: string, file: string): Map<string, ListedModule> {
  const modules = new Map<string, ListedModule>();
  if (text === "") return modules;
  const lines = text.split("\n");
  if (lines.at(-1) !== "") throw new GeneratorError(`${file}:${lines.length}: the file does not end in a newline`);
  lines.pop();

  let previousSpecifier: string | undefined;
  for (const [index, line] of lines.entries()) {
    const lineError = (problem: string) => new GeneratorError(`${file}:${index + 1}: ${problem}`);
    if (line === "") throw lineError("empty line");
    const [module, ...words] = line.split(" ");
    if (module === "" || words.includes("")) throw lineError("stray blank");
    const isFunction = module.endsWith(functionMark);
    const specifier = isFunction ? module.slice(0, -functionMark.length) : module;
    if (specifier.includes("=")) throw lineError(`${module}: after the specifier comes "${functionMark}" or nothing`);
    if (previousSpecifier !== undefined && compareBytes(previousSpecifier, specifier) >= 0) {
      throw lineError(`${specifier} is not in strict ascending order`);
    }
    const listed: ListedExport[] = [];
    for (const word of words) {
      const entry = parseListedExport(word);
      if (entry === null) throw lineError(`${word} does not name another holder than the name alone does`);
      const previous = listed.at(-1);
      if (previous !== undefined && compareBytes(previous.name, entry.name) >= 0) {
        throw lineError(`${entry.name} is not in strict ascending order`);
      }
      listed.push(entry);
    }
    modules.set(specifier, { isFunction, exports: listed });
    previousSpecifier = specifier;
  }
  return modules;
}

function readExportLists(bunRoot: string): ExportLists {
  const read = (file: string) => parseModuleExports(readFileSync(path.join(bunRoot, file), "utf8"), file);
  return { listed: read(exportsFile), absentOnWindows: read(absentOnWindowsFile) };
}

function lineNumbersOf(list: ReadonlyMap<string, ListedModule>): Map<string, number> {
  return new Map([...list.keys()].map((specifier, index) => [specifier, index + 1]));
}

function checkExportLists(
  sources: readonly RuntimeModuleSource[],
  leftOut: readonly string[],
  lists: ExportLists,
  problems: Problems,
): void {
  const specifiers = new Set([...sources.map(source => source.specifier), ...leftOut]);
  for (const [file, list] of [
    [exportsFile, lists.listed],
    [absentOnWindowsFile, lists.absentOnWindows],
  ] as const) {
    for (const [specifier, line] of lineNumbersOf(list)) {
      if (!specifiers.has(specifier)) problems.add(sourceAt(file, line), `${specifier} is not a runtime module`);
    }
  }
  for (const [specifier, line] of lineNumbersOf(lists.absentOnWindows)) {
    const listed = new Set(lists.listed.get(specifier)?.exports.map(({ name }) => name));
    const source = sourceAt(absentOnWindowsFile, line);
    if (lists.absentOnWindows.get(specifier)?.isFunction)
      problems.add(source, `${specifier} has the mark ${functionMark}`);
    for (const { name, holder } of lists.absentOnWindows.get(specifier)?.exports ?? []) {
      if (!listed.has(name)) problems.add(source, `${specifier} ${name} is not in ${exportsFile}`);
      if (holder !== unwrittenHolderOf(name)) problems.add(source, `${specifier} ${name} names a holder`);
    }
  }
  for (const { specifier, hasSource } of sources) {
    if (hasSource || openNamespaces.has(specifier) || lists.listed.has(specifier)) continue;
    problems.add(sourceAt(exportsFile, null), `the native module ${specifier} has no line`);
  }
}

function findKnownExports(
  { specifier, hasSource }: RuntimeModuleSource,
  lists: ExportLists,
): ModuleExportDeclaration[] {
  const listed = lists.listed.get(specifier)?.exports ?? [];
  const absentOnWindows = new Set(lists.absentOnWindows.get(specifier)?.exports.map(({ name }) => name));
  const observed = partiallyListedModules.has(specifier) ? observedPlatforms : targetPlatforms;
  const objectAsDefault: ListedExport = { name: defaultExport, holder: "ModuleObject" };
  const exports =
    hasSource || listed.some(({ name }) => name === defaultExport)
      ? listed
      : [...listed, objectAsDefault].sort((left, right) => compareBytes(left.name, right.name));
  return exports.map(({ name, holder }) => ({
    name,
    holder,
    platforms:
      !hasSource && name === defaultExport
        ? targetPlatforms
        : observed.filter(platform => platform !== "Windows" || !absentOnWindows.has(name)),
  }));
}

function declareExport(
  exportPath: BuiltinPath,
  platforms: readonly TargetPlatform[],
  isBindingOfNamespaceOnly: boolean,
): MemberDeclaration {
  return {
    declares: "Member",
    path: exportPath,
    kind: "DataProperty",
    isOwnPropertyOfInstances: false,
    isLazilyCreated: false,
    signatures: [],
    dispatches: [],
    constant: null,
    length: null,
    columns: {
      ...(platforms.length === targetPlatforms.length ? {} : { platforms }),
      ...(isBindingOfNamespaceOnly ? { defaultExport: true } : {}),
    },
  };
}

function readImportableSpecifiers(bunRoot: string): Set<string> {
  const text = readFileSync(path.join(bunRoot, importableModulesFile), "utf8");
  return new Set(Array.from(text.matchAll(importableSpecifierPattern), match => match[1]));
}

// An import is read from the object under its name, which finds what the object inherits too. Only what lies on the object is a member of it.
function findOwnNames(bunRoot: string, holder: BuiltinPath | null): ReadonlySet<string> | null {
  if (holder === null) return null;
  const lines = parseOwnProperties(readFileSync(path.join(bunRoot, ownPropertiesFile), "utf8"));
  const line = lines.find(candidate => candidate.holder === holder && !candidate.isOpen);
  return line === undefined ? null : new Set(line.properties.map(({ name }) => name));
}

function declareModule(
  bunRoot: string,
  source: RuntimeModuleSource,
  lists: ExportLists,
  importableSpecifiers: ReadonlySet<string>,
): Declaration[] {
  const { specifier, registryId, registryField, hasSource, isEsModule } = source;
  const hasOpenNamespace = openNamespaces.has(specifier);
  const namespacePath = objectModules.get(specifier) ?? null;
  const namespace = namespacePath ?? specifier;
  const exports = findKnownExports(source, lists);
  const ownNames = findOwnNames(bunRoot, namespacePath);
  const exportsOfObject = exports.filter(
    ({ name, holder }) => holder === "ModuleObject" || (holder === "Property" && (ownNames?.has(name) ?? true)),
  );
  return [
    {
      declares: "Module",
      specifier,
      registryId,
      registryField,
      hasSource,
      isEsModule,
      hasOpenNamespace,
      listsAllExports:
        !hasSource &&
        !hasOpenNamespace &&
        !partiallyListedModules.has(specifier) &&
        !runtimeDecidedModules.has(specifier),
      isPublic: importableSpecifiers.has(specifier) && !modulesOfBunsOwnTests.has(specifier),
      isFunction: lists.listed.get(specifier)?.isFunction ?? null,
      namespacePath,
      exports,
      exportsHeldByNamespace: exports.filter(({ holder }) => holder === "Namespace").map(({ name }) => name),
    },
    ...exportsOfObject.flatMap(({ name, holder, platforms }): Declaration[] => {
      const exportPath = memberPathOf(namespace, name);
      const member = declareExport(exportPath, platforms, holder === "ModuleObject");
      return holder === "ModuleObject"
        ? [member, { declares: "SameObject", path: exportPath, original: namespace }]
        : [member];
    }),
  ];
}

export function collectModules(
  bunRoot: string,
  written: readonly SourcedDeclaration[],
  problems: Problems,
): SourcedDeclaration[] {
  const lists = parseOrReport(problems, () => readExportLists(bunRoot));
  if (lists === null) return [];
  const sources = runtimeModuleSources().sort((left, right) => left.registryId - right.registryId);
  checkExportLists(
    sources,
    leftOutOf(written).flatMap(leftOut => leftOut.modules),
    lists,
    problems,
  );
  const lines = lineNumbersOf(lists.listed);
  const importableSpecifiers = readImportableSpecifiers(bunRoot);
  return sources.flatMap(source => {
    const declaredAt = sourceAt(exportsFile, lines.get(source.specifier) ?? null);
    if (source.specifier.includes(".")) {
      problems.add(
        declaredAt,
        `${source.specifier}: a module specifier is one component of a path and cannot contain "."`,
      );
      return [];
    }
    return withSource(declareModule(bunRoot, source, lists, importableSpecifiers), declaredAt);
  });
}
