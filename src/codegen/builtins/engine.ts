// What WebKit's own build makes of the table: the files that the engine is compiled with, and a table for the programs that it links.
// Nothing here reads a file of Bun's natives.
import { join, resolve } from "node:path";
import { loadSchema, type Schema } from "../aot-schema/load.ts";
import { buildModel } from "./build-model.ts";
import { collectRuntimeFunctions } from "./collect-runtime-functions.ts";
import { collectStaticTables } from "./collect-static-tables.ts";
import { GeneratorError, Problems, type SourcedDeclaration } from "./declarations.ts";
import { emitCppAttachments } from "./emit-cpp-attachments.ts";
import { emitEngineBindings } from "./emit-cpp-bindings.ts";
import { emitCppBuiltins } from "./emit-cpp-builtins.ts";
import { emitCppFeatures } from "./emit-cpp-features.ts";
import { emitCppArraysHeader, emitCppIds, engineListStampOf } from "./emit-cpp-ids.ts";
import { emitCppNames } from "./emit-cpp-names.ts";
import { emitCppOverloads } from "./emit-cpp-overloads.ts";
import { emitCppTypes } from "./emit-cpp-types.ts";
import { emitCppWords } from "./emit-cpp-words.ts";
import { serializeEngineDeclarations, type EngineDeclarations } from "./engine-declarations.ts";
import { engineFiles } from "./engine-sources.ts";
import { engineDeclarationFiles, loadDeclarationFiles } from "./load-declaration-files.ts";
import type { TableFeature, TableModel } from "./model.ts";
import { collectOwnProperties } from "./own-properties.ts";
import { readCMakeList, readFlags, writeIfChanged } from "./support.ts";

export const engineDeclarationsName = "AOTBuiltinEngineDeclarations.json";
export const arraysHeader = "AOTBuiltinTableArrays.h";

const tableListFile = "aot/builtins/AOTBuiltinTable.cmake";
const standInHostListName = "JavaScriptCore_AOT_BUILTIN_TABLE_STAND_IN_HOST_DECLARATIONS";
const standInHostOwnPropertiesName = "JavaScriptCore_AOT_BUILTIN_TABLE_STAND_IN_HOST_OWN_PROPERTIES";

export interface EngineCode {
  /** What the engine is compiled with. Only the engine's declarations decide what is in it, whichever host the model has. */
  engine: Map<string, string>;
  /** The table, as WebKit's own build compiles it. */
  table: Map<string, string>;
}

const singleRoot = (root: string): { Engine: string; Host: string } => ({ Engine: root, Host: root });

export async function collectEngine(javaScriptCore: string, problems: Problems): Promise<EngineDeclarations> {
  const written = await loadDeclarationFiles(engineDeclarationFiles(javaScriptCore), "Engine", javaScriptCore);
  const declared = [...written, ...collectStaticTables(written, singleRoot(javaScriptCore), problems)];
  const functions = collectRuntimeFunctions({ javaScriptCore, declared, frontEndFunctions: [] }, problems);
  problems.throwIfAny();
  return {
    declarations: [...declared, ...functions],
    engineFiles: engineFiles(javaScriptCore, declared),
  };
}

export function engineFeaturesOf(declarations: readonly SourcedDeclaration[]): TableFeature[] {
  const lists = declarations.flatMap(({ declaration }) =>
    declaration.declares === "EngineFeatures" ? [declaration] : [],
  );
  if (lists.length !== 1) throw new GeneratorError(`the engine has ${lists.length} lists of its features, not one`);
  return lists[0].names.map((name, index) => ({ name, index, isEngine: true }));
}

export function emitEngineCode(model: TableModel, schema: Schema, features: readonly TableFeature[]): EngineCode {
  const ids = emitCppIds(model);
  return {
    engine: new Map([
      ["AOTBuiltinFeatures.h", emitCppFeatures(model, features)],
      ["AOTBuiltinIDs.h", ids],
      ["AOTBuiltinTableEngineBindings.cpp", emitEngineBindings(model)],
      ["AOTBuiltinTableWords.h", emitCppWords(schema)],
    ]),
    table: new Map([
      [arraysHeader, emitCppArraysHeader(model, engineListStampOf(ids))],
      ["AOTBuiltinTableAttachments.cpp", emitCppAttachments(model, features)],
      ["AOTBuiltinTableBuiltins.cpp", emitCppBuiltins(model)],
      ["AOTBuiltinTableNames.cpp", emitCppNames(model)],
      ["AOTBuiltinTableOverloads.cpp", emitCppOverloads(model)],
      ["AOTBuiltinTableTypes.cpp", emitCppTypes(model)],
    ]),
  };
}

async function collectStandInHost(
  javaScriptCore: string,
  engine: EngineDeclarations,
  problems: Problems,
): Promise<SourcedDeclaration[]> {
  const listOf = (name: string): string[] => readCMakeList(join(javaScriptCore, tableListFile), name);
  const files = listOf(standInHostListName).map(file => resolve(javaScriptCore, file));
  const written = await loadDeclarationFiles(files, "Host", javaScriptCore);
  const declared = [
    ...written,
    ...listOf(standInHostOwnPropertiesName).flatMap(file => collectOwnProperties(javaScriptCore, file, problems)),
  ];
  const functions = collectRuntimeFunctions(
    { javaScriptCore: null, declared: [...engine.declarations, ...declared], frontEndFunctions: [] },
    problems,
  );
  return [...declared, ...functions];
}

export async function generateForEngine(javaScriptCore: string): Promise<EngineCode> {
  const problems = new Problems();
  const engine = await collectEngine(javaScriptCore, problems);
  const host = await collectStandInHost(javaScriptCore, engine, problems);
  problems.throwIfAny();
  const schema = loadSchema(join(javaScriptCore, "aot", "ir", "AOTSchema.def"));
  const features = engineFeaturesOf(engine.declarations);
  const model = buildModel({
    declarations: [...engine.declarations, ...host],
    schema,
    features,
    engineFiles: engine.engineFiles,
    syntaxUses: null,
  });
  const code = emitEngineCode(model, schema, features);
  code.engine.set(engineDeclarationsName, serializeEngineDeclarations(engine));
  return code;
}

async function main(): Promise<void> {
  const flags: Record<string, string | boolean | undefined> = readFlags(["javascriptcore", "out"]);
  const { javascriptcore: javaScriptCore, out } = flags;
  if (typeof javaScriptCore !== "string" || typeof out !== "string") {
    throw new GeneratorError("usage: engine.ts --javascriptcore=<Source/JavaScriptCore> --out=<dir>");
  }
  const { engine, table } = await generateForEngine(resolve(javaScriptCore));
  for (const [name, text] of [...engine, ...table]) writeIfChanged(join(resolve(out), name), text);
}

if (import.meta.main) {
  main().catch(error => {
    if (!(error instanceof GeneratorError)) throw error;
    console.error(`error: ${error.message}`);
    process.exit(1);
  });
}
