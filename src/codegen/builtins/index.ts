import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { BuildError } from "../../../scripts/build/error.ts";
import { serializeBuiltinUses } from "../../../scripts/build/trim/builtin-uses.ts";
import { loadFeatures } from "../../../scripts/build/trim/features.ts";
import type { FeatureModel } from "../../../scripts/build/trim/types.ts";
import { globAllSources } from "../../../scripts/glob-sources.ts";
import type { Schema } from "../../../vendor/WebKit/Source/JavaScriptCore/aot/ir/generator/load.ts";
import { builtinFunctionIds } from "../builtin-function-ids.ts";
import { nativeCalls, type EngineFunctions } from "../builtins-manifest-model.ts";
import { engineDirectory, engineFile } from "../engine-directory.ts";
import { nativeCallListStamp } from "../generate-js2native.ts";
import { argParse, writeIfNotChanged } from "../helpers.ts";
import { tableEntryRecord } from "../removable-entry-points.ts";
import { buildModel } from "./build-model.ts";
import { describeUndescribedResults, summarizeUndescribedResults } from "./check-dependencies.ts";
import { collectBindgen } from "./collect-bindgen.ts";
import { collectHostFunctions, collectPreludeFunctions } from "./collect-host-functions.ts";
import { collectModules, ownPropertiesFile } from "./collect-modules.ts";
import { collectNativeBindings } from "./collect-native-bindings.ts";
import { checkNativeCalls, collectBufferAccessors, collectNativeLoads } from "./collect-registrations.ts";
import { collectRuntimeFunctions } from "./collect-runtime-functions.ts";
import { collectStaticTables } from "./collect-static-tables.ts";
import { collectSyntaxUses } from "./collect-syntax-uses.ts";
import { GeneratorError, leftOutOf, Problems, symbolsNaming, type SourcedDeclaration } from "./declarations.ts";
import type { TableDump } from "./dump.ts";
import { emitHostBindings } from "./emit-cpp-bindings.ts";
import { dumpOf } from "./emit-dump.ts";
import { emitRustIds } from "./emit-rust-ids.ts";
import { emitRustParsers } from "./emit-rust-parsers.ts";
import { emitRustSyntax } from "./emit-rust-syntax.ts";
import { emitRustTable } from "./emit-rust-table.ts";
import { builtinUsesOf } from "./emit-uses.ts";
import {
  parseEngineDeclarations,
  serializeEngineDeclarations,
  type EngineDeclarations,
} from "./engine-declarations.ts";
import {
  arraysHeader,
  collectEngine,
  emitEngineCode,
  engineDeclarationsName,
  engineFeaturesOf,
  type EngineCode,
} from "./engine.ts";
import { hostDeclarationFiles, loadDeclarationFiles, registerLibraryModule } from "./load-declaration-files.ts";
import type { TableModel } from "./model.ts";
import { collectOwnProperties } from "./own-properties.ts";
import { compareBytes } from "./paths.ts";
import { targetPlatforms, type BuiltinPath, type FeatureUseSpec, type TargetPlatform } from "./vocabulary.ts";

const { loadSchema }: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/ir/generator/load.ts") =
  await import(engineFile("ir/generator/load.ts"));
const {
  SchemaError,
  SchemaErrors,
}: typeof import("../../../vendor/WebKit/Source/JavaScriptCore/aot/ir/generator/source.ts") = await import(
  engineFile("ir/generator/source.ts")
);

export interface GenerateOptions {
  bunRoot: string;
  javaScriptCore: string | null;
  prebuiltGenerated: string | null;
  target: TargetPlatform;
  bindgenSources: readonly string[];
  typesOnly: readonly string[];
  /** What the checkout of JavaScriptCore is compiled without. */
  leftOut?: readonly string[];
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

interface EmittedCode extends EngineCode {
  codegen: Map<string, string>;
}

interface CommandLine {
  options: GenerateOptions;
  codegenPath: string;
  /** Where the files go that the engine is compiled with, when this build compiles the engine. */
  engineOut: string | null;
  isCheck: boolean;
}

const ownBunRoot = resolve(import.meta.dir, "..", "..", "..");

const usage =
  "usage: bun src/codegen/builtins/index.ts --codegen-path=<dir> " +
  `--target=<${targetPlatforms.join("|")}> --sources=<crate>=<a.bind.ts>,.. ` +
  "(--javascriptcore=<Source/JavaScriptCore> [--engine-out=<dir>] | --prebuilt-generated=<dir>) " +
  "[--engine-directory=<Source/JavaScriptCore/aot>] [--types-only=<b.bind.ts>,..] [--left-out=<global>,..] [--check]";

const singleRoot = (root: string): { Engine: string; Host: string } => ({ Engine: root, Host: root });

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

function findFeatureUses(written: readonly SourcedDeclaration[]): Map<BuiltinPath, FeatureUseSpec[]> {
  const uses = new Map<BuiltinPath, FeatureUseSpec[]>();
  for (const { declaration } of written) {
    if (declaration.declares !== "Extension" || declaration.columns.usesFeature === undefined) continue;
    uses.set(declaration.path, [...(uses.get(declaration.path) ?? []), ...[declaration.columns.usesFeature].flat()]);
  }
  return uses;
}

const schemaFileNameOf = (bindgenSource: string): string =>
  basename(bindgenSource.slice(bindgenSource.indexOf("=") + 1));

export async function collectHost(options: GenerateOptions, problems: Problems): Promise<SourcedDeclaration[]> {
  const { bunRoot } = options;
  const typesOnly = new Set(options.typesOnly);
  const written = await loadDeclarationFiles(hostDeclarationFiles(bunRoot), "Host", bunRoot);
  const schemasLeftOut = new Set(leftOutOf(written).flatMap(leftOut => leftOut.schemas));
  const isLeftOut = (schemaFileName: string): boolean => schemasLeftOut.has(schemaFileName);
  const sources = options.bindgenSources.filter(source => !isLeftOut(schemaFileNameOf(source)));
  const staticTableMembers = collectStaticTables(written, singleRoot(bunRoot), problems);
  const { nativeModuleLoadSites, nativeCallSites } = globAllSources();
  checkNativeCalls(bunRoot, [...nativeModuleLoadSites, ...nativeCallSites], written, problems);
  // collectBindgen() asks which bindings src/js names, which this registers.
  const calls = nativeCalls(typesOnly);
  const writtenMembers = new Set(
    written.flatMap(({ declaration }) => (declaration.declares === "Member" ? [declaration.path] : [])),
  );
  const schemas = await collectBindgen(
    bunRoot,
    sources,
    findPlacements(staticTableMembers),
    writtenMembers,
    findFeatureUses(written),
    problems,
  );
  return [
    ...written,
    ...staticTableMembers,
    ...collectModules(bunRoot, written, problems),
    ...collectOwnProperties(bunRoot, ownPropertiesFile, problems),
    ...collectNativeBindings(calls, isLeftOut, schemas.bindingsOfOtherValues, problems),
    ...collectBufferAccessors(bunRoot, problems),
    ...collectNativeLoads(bunRoot, nativeModuleLoadSites, problems),
    ...schemas.declarations,
  ];
}

async function loadEngine(options: GenerateOptions, problems: Problems): Promise<EngineDeclarations> {
  if (options.javaScriptCore !== null) return collectEngine(options.javaScriptCore, problems, options.leftOut);
  if (options.prebuiltGenerated === null) {
    throw new GeneratorError("the table needs a JavaScriptCore checkout or what a prebuilt WebKit was compiled with");
  }
  const file = join(options.prebuiltGenerated, engineDeclarationsName);
  return parseEngineDeclarations(readFileSync(file, "utf8"), file);
}

async function collectDeclarations(
  options: GenerateOptions,
  engine: EngineDeclarations,
  problems: Problems,
): Promise<SourcedDeclaration[]> {
  const declared = [...engine.declarations, ...(await collectHost(options, problems))];
  const hostFunctionIds = builtinFunctionIds(join(options.bunRoot, "src", "js", "builtins"));
  const compilerFunctions = collectRuntimeFunctions(
    { javaScriptCore: null, declared, frontEndFunctions: collectPreludeFunctions(options.bunRoot) },
    problems,
  );
  return [...declared, ...compilerFunctions, ...collectHostFunctions(hostFunctionIds, declared, problems)];
}

interface EmitterInput {
  model: TableModel;
  schema: Schema;
  features: FeatureModel;
  nativeCallListStamp: string;
}

// Bun compiles the table beside its own sources, where a header of the engine is a header of a framework.
function spellIncludesForHost(text: string): string {
  return text
    .replace('#include "config.h"', '#include "root.h"')
    .replace(/^#include "(\w+\.h)"$/gm, (include, header) =>
      header === arraysHeader || header === "root.h" ? include : `#include <JavaScriptCore/${header}>`,
    );
}

function emitCode({ model, schema, features, nativeCallListStamp }: EmitterInput): EmittedCode {
  const { engine, table } = emitEngineCode(model, schema, features.features);
  return {
    engine,
    table,
    codegen: new Map([
      ...Array.from(table, ([name, text]): [string, string] => [name, spellIncludesForHost(text)]),
      [
        "BunAOTHostBindings.cpp",
        emitHostBindings(model, (...record) => tableEntryRecord(features, ...record), nativeCallListStamp),
      ],
      ["aot_builtin_ids.rs", emitRustIds(model, schema)],
      ["aot_builtin_syntax.rs", emitRustSyntax(model)],
      ["aot_builtin_table.rs", emitRustTable(model) + emitRustParsers(model)],
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

// The engine numbers its features. src/trim/features/engine.def says what Bun's link has to know about each.
function checkEngineFeatures(engine: EngineDeclarations, features: FeatureModel): void {
  const declared = engineFeaturesOf(engine.declarations);
  const described = features.features
    .filter(feature => feature.isEngine)
    .sort((left, right) => left.index - right.index);
  const problems = new Problems();
  for (let index = 0; index < Math.max(declared.length, described.length); index++) {
    const [ofEngine, ofBun] = [declared[index]?.name ?? "nothing", described[index]?.name ?? "nothing"];
    if (ofEngine === ofBun && described[index].index === index) continue;
    problems.add(
      null,
      `feature ${index} of the engine is ${ofEngine} in WebKit's aot/builtins/features.builtins.ts and ${ofBun} in src/trim/features/engine.def`,
    );
  }
  problems.throwIfAny();
}

export async function generate(options: GenerateOptions): Promise<GeneratedFiles> {
  registerLibraryModule();
  const problems = new Problems();
  const engine = await loadEngine(options, problems);
  const declarations = await collectDeclarations(options, engine, problems);
  problems.throwIfAny();

  const schema = loadSchema(join(engineDirectory, "ir", "AOTSchema.def"));
  const features = loadFeatures(options.bunRoot);
  checkEngineFeatures(engine, features);
  const model = buildModel({
    declarations,
    schema,
    features: features.features,
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

const remedyForPrebuilt =
  "this WebKit was compiled with another list of the built-ins that its own code names than the one this tree declares: " +
  "a change to an entry that the engine declares or that aot/builtins/host-roles.builtins.ts lists needs a build of WebKit. " +
  "Build with --webkit=local, or pin a release of WebKit that was built from this tree's declarations";

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
    "engine-out",
    "engine-directory",
    "prebuilt-generated",
    "types-only",
    "left-out",
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
  const engineOut = directoryOf("engine-out");
  const isCheck = flags.check === true;
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
      leftOut: listOf(textOf("left-out") ?? ""),
    },
    codegenPath,
    engineOut,
    isCheck,
  };
}

async function main(): Promise<void> {
  const { options, codegenPath, engineOut, isCheck } = readCommandLine();
  const { engine, codegen, undescribedResultsSummary } = await generate(options);
  if (options.prebuiltGenerated !== null) checkFilesAreCurrent(options.prebuiltGenerated, engine, remedyForPrebuilt);
  else if (engineOut !== null && !isCheck) writeFiles(engineOut, engine);
  if (!isCheck) writeFiles(codegenPath, codegen);
  console.error(`builtins table: ${undescribedResultsSummary}`);
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
