import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { BuildError } from "../../../scripts/build/error.ts";
import { serializeBuiltinUses } from "../../../scripts/build/trim/builtin-uses.ts";
import { loadFeatures } from "../../../scripts/build/trim/features.ts";
import type { FeatureModel } from "../../../scripts/build/trim/types.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import { loadSchema, type Schema } from "../aot-schema/load.ts";
import { SchemaError, SchemaErrors } from "../aot-schema/source.ts";
import { builtinFunctionIds } from "../builtin-function-ids.ts";
import { nativeCalls, type EngineFunctions } from "../builtins-manifest-model.ts";
import { nativeCallListStamp } from "../generate-js2native.ts";
import { argParse, writeIfNotChanged } from "../helpers.ts";
import { buildModel } from "./build-model.ts";
import { collectSyntaxUses } from "./build-syntax.ts";
import { describeUndescribedResults, summarizeUndescribedResults } from "./check-dependencies.ts";
import { collectBindgen } from "./collect-bindgen.ts";
import { collectModules, collectOwnProperties } from "./collect-modules.ts";
import { collectNativeBindings } from "./collect-native-bindings.ts";
import { checkNativeCalls, collectBufferAccessors, collectNativeLoads } from "./collect-registrations.ts";
import { collectRuntimeFunctions } from "./collect-runtime-functions.ts";
import { collectStaticTables } from "./collect-static-tables.ts";
import { GeneratorError, Problems, symbolsNaming, type SourcedDeclaration } from "./declarations.ts";
import { verifiedListPaths, type TableDump } from "./dump.ts";
import { emitCppAttachments } from "./emit-cpp-attachments.ts";
import { emitEngineBindings, emitHostBindings } from "./emit-cpp-bindings.ts";
import { emitCppBuiltins } from "./emit-cpp-builtins.ts";
import { emitCppFeatures } from "./emit-cpp-features.ts";
import { emitCppArraysHeader, emitCppIds, engineListStampOf } from "./emit-cpp-ids.ts";
import { emitCppNames } from "./emit-cpp-names.ts";
import { emitCppOverloads } from "./emit-cpp-overloads.ts";
import { emitCppTypes } from "./emit-cpp-types.ts";
import { emitCppWords } from "./emit-cpp-words.ts";
import { dumpOf } from "./emit-dump.ts";
import { emitRustIds } from "./emit-rust-ids.ts";
import { emitRustSyntax } from "./emit-rust-syntax.ts";
import { emitRustTable } from "./emit-rust-table.ts";
import { builtinUsesOf } from "./emit-uses.ts";
import {
  parseEngineDeclarations,
  serializeEngineDeclarations,
  type EngineDeclarations,
} from "./engine-declarations.ts";
import { engineFiles } from "./engine-sources.ts";
import {
  engineDeclarationFiles,
  hostDeclarationFiles,
  loadDeclarationFiles,
  registerLibraryModule,
} from "./load-declaration-files.ts";
import type { TableModel } from "./model.ts";
import { compareBytes } from "./paths.ts";
import { readVerifiedHashes, reportStaleEntries } from "./verification.ts";
import { targetPlatforms, type BuiltinPath, type TargetPlatform } from "./vocabulary.ts";

export interface GenerateOptions {
  bunRoot: string;
  javaScriptCore: string | null;
  prebuiltGenerated: string | null;
  target: TargetPlatform;
  bindgenSources: readonly string[];
  typesOnly: readonly string[];
}

export interface GeneratedFiles {
  /** What the engine is compiled with. Only the engine's declarations decide what is in it, so a prebuilt WebKit has the same. */
  engine: Map<string, string>;
  /** The table, as WebKit's own build compiles it into its programs. */
  table: Map<string, string>;
  codegen: Map<string, string>;
  dump: TableDump;
  undescribedResultsSummary: string;
}

interface EmittedCode {
  engine: Map<string, string>;
  table: Map<string, string>;
  codegen: Map<string, string>;
}

interface CommandLine {
  options: GenerateOptions;
  codegenPath: string;
  requiresVerified: boolean;
  isCheck: boolean;
}

const ownBunRoot = resolve(import.meta.dir, "..", "..", "..");
const engineDeclarationsName = "AOTBuiltinEngineDeclarations.json";

const usage =
  "usage: bun src/codegen/builtins/index.ts --codegen-path=<dir> " +
  `--target=<${targetPlatforms.join("|")}> --sources=<crate>=<a.bind.ts>,.. ` +
  "(--javascriptcore=<Source/JavaScriptCore> | --prebuilt-generated=<dir>) " +
  "[--types-only=<b.bind.ts>,..] [--require-verified] [--check]";

const singleRoot = (root: string): { Engine: string; Host: string } => ({ Engine: root, Host: root });

function generatedDirectoryOf({ javaScriptCore, prebuiltGenerated }: GenerateOptions): string {
  if (javaScriptCore !== null) return join(javaScriptCore, "aot", "builtins", "generated");
  if (prebuiltGenerated !== null) return prebuiltGenerated;
  throw new GeneratorError("the table needs a JavaScriptCore checkout or the generated folder of a prebuilt WebKit");
}

const engineDirectoryOf = (options: GenerateOptions): string =>
  resolve(generatedDirectoryOf(options), "..", "..", "..");

const verifiedHashesOf = (options: GenerateOptions): Set<string> =>
  readVerifiedHashes(verifiedListPaths(options.bunRoot, engineDirectoryOf(options)));

export async function collectEngine(javaScriptCore: string, problems: Problems): Promise<EngineDeclarations> {
  const written = await loadDeclarationFiles(engineDeclarationFiles(javaScriptCore), "Engine", javaScriptCore);
  const declared = [...written, ...collectStaticTables(written, singleRoot(javaScriptCore), problems)];
  const functions = collectRuntimeFunctions(
    { javaScriptCore, bunRoot: ownBunRoot, declared, hostFunctionIds: new Map() },
    problems,
  ).filter(({ source }) => source.origin === "Engine");
  problems.throwIfAny();
  return {
    declarations: [...declared, ...functions],
    engineFiles: engineFiles(javaScriptCore, declared),
  };
}

function findPlacements(staticTableMembers: readonly SourcedDeclaration[]): Map<string, BuiltinPath> {
  const placements = new Map<string, BuiltinPath>();
  for (const { declaration } of staticTableMembers) {
    if (declaration.declares !== "Member") continue;
    for (const symbol of symbolsNaming(declaration)) {
      if (!placements.has(symbol)) placements.set(symbol, declaration.path);
    }
  }
  return placements;
}

const schemaFileNameOf = (bindgenSource: string): string =>
  basename(bindgenSource.slice(bindgenSource.indexOf("=") + 1));

// Only some builds of Bun compile such a schema: isCompiled() in scripts/build/codegen.ts.
const bindsWhatExistsForTests = (schemaFileName: string): boolean => schemaFileName.endsWith("_test.bind.ts");

export async function collectHost(options: GenerateOptions, problems: Problems): Promise<SourcedDeclaration[]> {
  const { bunRoot } = options;
  const typesOnly = new Set(options.typesOnly);
  const sourcesOfEveryBuild = options.bindgenSources.filter(
    source => !bindsWhatExistsForTests(schemaFileNameOf(source)),
  );
  const written = await loadDeclarationFiles(hostDeclarationFiles(bunRoot), "Host", bunRoot);
  const staticTableMembers = collectStaticTables(written, singleRoot(bunRoot), problems);
  const { nativeModuleLoadSites, nativeCallSites } = globAllSources();
  checkNativeCalls(bunRoot, [...nativeModuleLoadSites, ...nativeCallSites], written, problems);
  // collectBindgen() asks which bindings src/js names, which this registers.
  const calls = nativeCalls(typesOnly);
  const schemas = await collectBindgen(bunRoot, sourcesOfEveryBuild, findPlacements(staticTableMembers), problems);
  return [
    ...written,
    ...staticTableMembers,
    ...collectModules(bunRoot, problems),
    ...collectOwnProperties(bunRoot, problems),
    ...collectNativeBindings(calls, bindsWhatExistsForTests, schemas.constructorBindings, problems),
    ...collectBufferAccessors(bunRoot, problems),
    ...collectNativeLoads(bunRoot, nativeModuleLoadSites, problems),
    ...schemas.declarations,
  ];
}

async function loadEngine(options: GenerateOptions, problems: Problems): Promise<EngineDeclarations> {
  if (options.javaScriptCore !== null) return collectEngine(options.javaScriptCore, problems);
  const file = join(generatedDirectoryOf(options), engineDeclarationsName);
  return parseEngineDeclarations(readFileSync(file, "utf8"), file);
}

async function collectDeclarations(
  options: GenerateOptions,
  engine: EngineDeclarations,
  problems: Problems,
): Promise<SourcedDeclaration[]> {
  const declared = [...engine.declarations, ...(await collectHost(options, problems))];
  const hostFunctionIds = builtinFunctionIds(join(options.bunRoot, "src", "js", "builtins"));
  const hostFunctions = collectRuntimeFunctions(
    { javaScriptCore: null, bunRoot: options.bunRoot, declared, hostFunctionIds },
    problems,
  );
  return [...declared, ...hostFunctions];
}

interface EmitterInput {
  model: TableModel;
  schema: Schema;
  features: FeatureModel;
  nativeCallListStamp: string;
}

const arraysHeader = "AOTBuiltinTableArrays.h";

// Bun compiles the table beside its own sources, where a header of the engine is a header of a framework.
function spellIncludesForHost(text: string): string {
  return text
    .replace('#include "config.h"', '#include "root.h"')
    .replace(/^#include "(\w+\.h)"$/gm, (include, header) =>
      header === arraysHeader || header === "root.h" ? include : `#include <JavaScriptCore/${header}>`,
    );
}

function emitCode({ model, schema, features, nativeCallListStamp }: EmitterInput): EmittedCode {
  const ids = emitCppIds(model);
  const table = new Map([
    [arraysHeader, emitCppArraysHeader(model, engineListStampOf(ids))],
    ["AOTBuiltinTableAttachments.cpp", emitCppAttachments(model, features)],
    ["AOTBuiltinTableBuiltins.cpp", emitCppBuiltins(model)],
    ["AOTBuiltinTableNames.cpp", emitCppNames(model)],
    ["AOTBuiltinTableOverloads.cpp", emitCppOverloads(model)],
    ["AOTBuiltinTableTypes.cpp", emitCppTypes(model)],
  ]);
  return {
    engine: new Map([
      ["AOTBuiltinFeatures.h", emitCppFeatures(model, features)],
      ["AOTBuiltinIDs.h", ids],
      ["AOTBuiltinTableEngineBindings.cpp", emitEngineBindings(model)],
      ["AOTBuiltinTableWords.h", emitCppWords(schema)],
    ]),
    table,
    codegen: new Map([
      ...Array.from(table, ([name, text]): [string, string] => [name, spellIncludesForHost(text)]),
      ["BunAOTHostBindings.cpp", emitHostBindings(model, features, nativeCallListStamp)],
      ["aot_builtin_ids.rs", emitRustIds(model, schema)],
      ["aot_builtin_syntax.rs", emitRustSyntax(model)],
      ["aot_builtin_table.rs", emitRustTable(model)],
    ]),
  };
}

function engineFunctionsOf(model: TableModel): EngineFunctions {
  const fileNames = new Set(model.engineFiles.map(({ name }) => name));
  return {
    files: [...model.engineFiles],
    functions: model.functions
      .map(({ id, file, name, exportName }) => ({ id, file: `${file}.ts`, name, exportName }))
      .filter(({ file }) => fileNames.has(file)),
  };
}

export async function generate(options: GenerateOptions): Promise<GeneratedFiles> {
  registerLibraryModule();
  const problems = new Problems();
  const engine = await loadEngine(options, problems);
  const declarations = await collectDeclarations(options, engine, problems);
  problems.throwIfAny();

  const schema = loadSchema(join(engineDirectoryOf(options), "aot", "ir", "AOTSchema.def"));
  const features = loadFeatures(options.bunRoot);
  const model = buildModel({
    declarations,
    schema,
    features,
    engineFiles: engine.engineFiles,
    syntaxUses: collectSyntaxUses(options.bunRoot, engine.engineFiles),
  });

  const {
    engine: engineCode,
    table,
    codegen,
  } = emitCode({
    model,
    schema,
    features,
    nativeCallListStamp: nativeCallListStamp(),
  });
  const dump = dumpOf(model);
  engineCode.set(engineDeclarationsName, serializeEngineDeclarations(engine));
  codegen.set("builtin-uses.json", serializeBuiltinUses(builtinUsesOf(model, options.target)));
  codegen.set("aot_builtin_table.json", `${JSON.stringify(dump)}\n`);
  codegen.set("aot_engine_functions.json", `${JSON.stringify(engineFunctionsOf(model))}\n`);
  codegen.set("aot_builtin_undescribed_results.txt", describeUndescribedResults(model));
  return { engine: engineCode, table, codegen, dump, undescribedResultsSummary: summarizeUndescribedResults(model) };
}

function writeFiles(directory: string, files: ReadonlyMap<string, string>): void {
  for (const [name, text] of files) writeIfNotChanged(join(directory, name), text);
}

const normalizedTextOf = (text: string): string => text.replaceAll("\r\n", "\n").trim();

const longestLineShown = 160;
const shownLineOf = (line: string | undefined): string =>
  line === undefined
    ? "nothing"
    : `\`${line.length > longestLineShown ? `${line.slice(0, longestLineShown)} ..` : line}\``;

function describeFirstDifference(found: string, written: string): string {
  const foundLines = found.split("\n");
  const writtenLines = written.split("\n");
  const different = writtenLines.findIndex((line, index) => line !== foundLines[index]);
  const index = different === -1 ? writtenLines.length : different;
  return `line ${index + 1} is ${shownLineOf(foundLines[index])}, and this tree writes ${shownLineOf(writtenLines[index])}`;
}

const remedyForCheckout = "run src/codegen/builtins/index.ts without --check and check the result in";
const remedyForPrebuilt =
  "this WebKit was compiled with another list of the built-ins that its own code names than the one this tree declares: " +
  "a change to an entry that the engine declares or that aot/builtins/host-roles.builtins.ts lists needs a build of WebKit. " +
  "Build with --webkit=local, or pin a release of WebKit whose aot/builtins/generated was written from this tree";

function checkFilesAreCurrent(directory: string, files: ReadonlyMap<string, string>, remedy: string): void {
  const problems = new Problems();
  for (const [name, text] of files) {
    const file = join(directory, name);
    if (!existsSync(file)) {
      problems.add(null, `${file} is missing`);
      continue;
    }
    const found = normalizedTextOf(readFileSync(file, "utf8"));
    const written = normalizedTextOf(text);
    if (found !== written) problems.add(null, `${file}: ${describeFirstDifference(found, written)}`);
  }
  if (problems.isEmpty) return;
  problems.add(null, remedy);
  problems.throwIfAny();
}

const listOf = (value: string): string[] => value.split(",").filter(item => item !== "");

function readCommandLine(): CommandLine {
  const flags: Record<string, string | boolean | undefined> = argParse([
    "codegen-path",
    "target",
    "sources",
    "javascriptcore",
    "prebuilt-generated",
    "types-only",
    "require-verified",
    "check",
  ]);
  const textOf = (name: string): string | null => {
    const value = flags[name];
    return typeof value === "string" ? value : null;
  };
  const directoryOf = (name: string): string | null => {
    const value = textOf(name);
    return value === null ? null : resolve(value);
  };
  const target = targetPlatforms.find(platform => platform === flags.target);
  const codegenPath = directoryOf("codegen-path");
  const sources = textOf("sources");
  const javaScriptCore = directoryOf("javascriptcore");
  const prebuiltGenerated = directoryOf("prebuilt-generated");
  const hasOneEngine = (javaScriptCore === null) !== (prebuiltGenerated === null);
  if (target === undefined || codegenPath === null || sources === null || !hasOneEngine) {
    throw new GeneratorError(usage);
  }
  return {
    options: {
      bunRoot: ownBunRoot,
      javaScriptCore,
      prebuiltGenerated,
      target,
      bindgenSources: listOf(sources).sort(compareBytes),
      typesOnly: listOf(textOf("types-only") ?? ""),
    },
    codegenPath,
    requiresVerified: flags["require-verified"] === true,
    isCheck: flags.check === true,
  };
}

async function main(): Promise<void> {
  const { options, codegenPath, requiresVerified, isCheck } = readCommandLine();
  const { engine, table, codegen, dump, undescribedResultsSummary } = await generate(options);
  const generatedDirectory = generatedDirectoryOf(options);
  if (options.javaScriptCore === null) checkFilesAreCurrent(generatedDirectory, engine, remedyForPrebuilt);
  else if (isCheck) checkFilesAreCurrent(generatedDirectory, new Map([...engine, ...table]), remedyForCheckout);
  else writeFiles(generatedDirectory, new Map([...engine, ...table]));
  if (!isCheck) writeFiles(codegenPath, codegen);
  console.error(`builtins table: ${undescribedResultsSummary}`);
  reportStaleEntries(dump, verifiedHashesOf(options), requiresVerified);
}

function exitWithError(error: unknown): never {
  if (error instanceof BuildError) {
    process.stderr.write(error.format());
  } else if (error instanceof GeneratorError || error instanceof SchemaError || error instanceof SchemaErrors) {
    console.error(`error: ${error.message}`);
  } else {
    throw error;
  }
  process.exit(1);
}

if (import.meta.main) main().catch(exitWithError);
