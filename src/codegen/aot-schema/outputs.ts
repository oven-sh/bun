import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { emitCppAccessors } from "./emit-cpp-accessors.ts";
import { emitCppDispatch } from "./emit-cpp-dispatch.ts";
import { emitCppEffects } from "./emit-cpp-effects.ts";
import { emitCppEnums } from "./emit-cpp-enums.ts";
import { emitCppInlineBuiltins } from "./emit-cpp-inline-builtins.ts";
import { emitCppOperations } from "./emit-cpp-operations.ts";
import { emitCppParser } from "./emit-cpp-parser.ts";
import { emitCppPrinter } from "./emit-cpp-printer.ts";
import { emitCppReader } from "./emit-cpp-reader.ts";
import { emitCppRecords } from "./emit-cpp-records.ts";
import { emitCppResultRules } from "./emit-cpp-result-rules.ts";
import { emitCppRuntimeOperations } from "./emit-cpp-runtime-operations.ts";
import { emitCppVerifier } from "./emit-cpp-verifier.ts";
import { emitCppWalkers } from "./emit-cpp-walkers.ts";
import { emitCppWire } from "./emit-cpp-wire.ts";
import { emitRustAbi } from "./emit-rust-abi.ts";
import { emitRustBuilder } from "./emit-rust-builder.ts";
import { emitRustChecks } from "./emit-rust-checks.ts";
import { emitRustEntries } from "./emit-rust-entries.ts";
import { emitRustEntryText } from "./emit-rust-entry-text.ts";
import { emitRustEnums } from "./emit-rust-enums.ts";
import { emitRustRecords } from "./emit-rust-records.ts";
import { emitRustReferences } from "./emit-rust-references.ts";
import { emitRustText } from "./emit-rust-text.ts";
import { emitRustUses } from "./emit-rust-uses.ts";
import { emitRustWriter } from "./emit-rust-writer.ts";
import { cppMarker, rustMarker, toText, type Lines } from "./lines.ts";
import type { LoadedSchema } from "./load.ts";
import type { Schema } from "./model.ts";
import { screamingCase } from "./names.ts";

export interface OutputFile {
  readonly name: string;
  readonly lines: Lines;
}

export interface EmitContext {
  readonly schema: Schema;
  readonly hash: bigint;
}

export type Emitter = (context: EmitContext) => OutputFile[];

export const inputsHashFileName = "AOTSchemaInputs.sha256";
export const fileListName = "AOTSchemaFiles.cmake";
export const hashHeaderName = "AOTSchemaHash.h";
export const maxInterfaceLines = 1000;
export const maxInterfaceBytes = 160000;

const cmakeMarker = cppMarker.replace("//", "#");

const engineEmitters: readonly Emitter[] = [
  emitCppEnums,
  emitCppWire,
  emitCppRecords,
  emitCppOperations,
  emitCppAccessors,
  emitCppEffects,
  emitCppReader,
  emitCppPrinter,
  emitCppParser,
  emitCppWalkers,
  emitCppVerifier,
  emitCppResultRules,
  emitCppRuntimeOperations,
  emitCppInlineBuiltins,
  emitCppDispatch,
];

const rustEmitters: readonly Emitter[] = [
  emitRustEnums,
  emitRustEntries,
  emitRustUses,
  emitRustAbi,
  emitRustRecords,
  emitRustReferences,
  emitRustWriter,
  emitRustText,
  emitRustEntryText,
  emitRustBuilder,
  emitRustChecks,
];

function byName(left: OutputFile, right: OutputFile): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

export function isInterfaceOutput(name: string): boolean {
  if (name.endsWith(".rs")) return !name.startsWith("record_") && !name.startsWith("entry_") && name !== "checks.rs";
  return (name.endsWith(".h") && !name.endsWith("Inlines.h")) || name.endsWith(".inc");
}

function checkSize(file: OutputFile): void {
  if (!isInterfaceOutput(file.name)) return;
  const bytes = Buffer.byteLength(toText(file.lines));
  if (file.lines.length > maxInterfaceLines || bytes > maxInterfaceBytes) {
    throw new Error(`${file.name} has ${file.lines.length} lines and ${bytes} bytes: people read it, so its emitter has to split it`);
  }
}

export function runEmitters(emitters: readonly Emitter[], context: EmitContext): OutputFile[] {
  const files = emitters.flatMap(emitter => emitter(context)).sort(byName);
  for (let index = 1; index < files.length; index += 1) {
    if (files[index].name === files[index - 1].name) throw new Error(`two emitters write ${files[index].name}`);
  }
  files.forEach(checkSize);
  return files;
}

export function inputsHash(loaded: LoadedSchema): string {
  const digests = loaded.inputs.map(input => {
    const digest = createHash("sha256").update(fs.readFileSync(path.join(loaded.directory, input))).digest("hex");
    return `${digest} aot/ir/${input}`;
  });
  return createHash("sha256").update(`${digests.sort().join("\n")}\n`).digest("hex");
}

function cmakeList(name: string, entries: readonly string[]): string[] {
  return [`set(${name}`, ...entries.map(entry => `    ${entry}`), ")"];
}

function fileList(loaded: LoadedSchema, files: readonly OutputFile[]): OutputFile {
  const inFolder = (suffixes: readonly string[]) =>
    files.filter(file => suffixes.some(suffix => file.name.endsWith(suffix))).map(file => `aot/ir/generated/${file.name}`);
  return {
    name: fileListName,
    lines: [
      cmakeMarker,
      "",
      ...cmakeList(
        "JavaScriptCore_AOT_SCHEMA_INPUTS",
        loaded.inputs.map(input => `aot/ir/${input}`),
      ),
      "",
      ...cmakeList("JavaScriptCore_AOT_SCHEMA_GENERATED_HEADERS", inFolder([".h", ".inc"])),
      "",
      ...cmakeList("JavaScriptCore_AOT_SCHEMA_GENERATED_SOURCES", inFolder([".cpp"])),
    ],
  };
}

export function engineOutputs(loaded: LoadedSchema): OutputFile[] {
  const files = runEmitters(engineEmitters, { schema: loaded.model, hash: loaded.hash });
  return [...files, fileList(loaded, files), { name: inputsHashFileName, lines: [inputsHash(loaded)] }].sort(byName);
}

const modulesOfOtherCrates: Record<string, string> = {
  compile_call_enums: "bun_aot_interface::ir::generated",
  diagnostics: "bun_aot_interface::ir::generated",
  entries: "bun_aot_builtins",
  enums: "bun_aot_builtins",
  limits: "bun_aot_interface::ir::generated",
  statistics: "bun_aot_interface::ir::generated",
};

function rustModuleDeclaration(module: string): string[] {
  const parent = modulesOfOtherCrates[module];
  if (parent === undefined) return [`mod ${module};`];
  return ["#[cfg(test)]", `mod ${module};`, "#[cfg(not(test))]", `use ${parent}::${module};`];
}

function rustModuleFile(context: EmitContext, files: readonly OutputFile[]): OutputFile {
  const modules = files.map(file => file.name.slice(0, -".rs".length));
  const isReexported = (module: string) => module !== "checks" && !module.startsWith("builder_") && !module.startsWith("record_");
  const constants = context.schema.constants.map(constant => {
    const isWord = constant.value >= 0n && constant.value <= 0xffffffffn;
    const value = isWord && constant.value > 0xffffn ? `0x${constant.value.toString(16).padStart(8, "0")}` : constant.value.toString();
    return `pub const ${screamingCase(constant.name)}: ${isWord ? "u32" : "i64"} = ${value};`;
  });
  return {
    name: "mod.rs",
    lines: [
      rustMarker,
      "",
      "#![allow(dead_code, unreachable_pub, unused_imports, unused_variables)]",
      "#![allow(clippy::too_many_arguments, clippy::fn_params_excessive_bools, clippy::identity_op, clippy::cast_ptr_alignment)]",
      "",
      ...modules.filter(module => module !== "checks").flatMap(rustModuleDeclaration),
      "#[cfg(test)]",
      "mod checks;",
      "",
      ...modules.filter(isReexported).map(module => `pub use ${module}::*;`),
      "#[cfg(test)]",
      "pub use checks::*;",
      "",
      `pub const SCHEMA_HASH: u64 = 0x${context.hash.toString(16).padStart(16, "0")};`,
      ...constants,
    ],
  };
}

export function rustOutputs(loaded: LoadedSchema): OutputFile[] {
  const context = { schema: loaded.model, hash: loaded.hash };
  const files = runEmitters(rustEmitters, context);
  return [...files, rustModuleFile(context, files), hashHeader(loaded.hash)].sort(byName);
}

function hashHeader(hash: bigint): OutputFile {
  const lines = [rustMarker, "#pragma once", "", `#define BUN_AOT_SCHEMA_HASH 0x${hash.toString(16).padStart(16, "0")}ull`];
  return { name: hashHeaderName, lines };
}

function readIfPresent(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function isGenerated(text: string): boolean {
  return text.startsWith(cppMarker) || text.startsWith(rustMarker) || text.startsWith(cmakeMarker);
}

function leftoverFiles(directory: string, files: readonly OutputFile[]): string[] {
  const names = new Set(files.map(file => file.name));
  let present: string[];
  try {
    present = fs.readdirSync(directory).sort();
  } catch {
    return [];
  }
  return present.filter(name => !names.has(name) && isGenerated(readIfPresent(path.join(directory, name)) ?? ""));
}

export interface StaleFile {
  readonly name: string;
  readonly problem: "missing" | "differs" | "is no longer generated";
}

export function findStaleOutputs(directory: string, files: readonly OutputFile[]): StaleFile[] {
  const stale: StaleFile[] = [];
  for (const file of files) {
    const present = readIfPresent(path.join(directory, file.name));
    if (present === null) stale.push({ name: file.name, problem: "missing" });
    else if (present !== toText(file.lines)) stale.push({ name: file.name, problem: "differs" });
  }
  for (const name of leftoverFiles(directory, files)) stale.push({ name, problem: "is no longer generated" });
  return stale;
}

export function writeOutputs(directory: string, files: readonly OutputFile[]): string[] {
  fs.mkdirSync(directory, { recursive: true });
  const changed: string[] = [];
  for (const file of files) {
    const target = path.join(directory, file.name);
    const text = toText(file.lines);
    if (readIfPresent(target) === text) continue;
    fs.writeFileSync(target, text);
    changed.push(file.name);
  }
  for (const name of leftoverFiles(directory, files)) {
    fs.rmSync(path.join(directory, name));
    changed.push(name);
  }
  return changed;
}
