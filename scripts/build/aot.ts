import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { crateOf, debugFlag, shJoin, typesOnlyFlag, type Ctx } from "./codegen.ts";
import type { CodegenFields, Config } from "./config.ts";
import { assert } from "./error.ts";
import type { Ninja } from "./ninja.ts";
import { quote } from "./shell.ts";
import { streamPath } from "./stream.ts";

export interface EngineSources {
  /** `Source/JavaScriptCore` of the checkout this graph compiles. Undefined when it links a prebuilt WebKit. */
  javaScriptCore: string | undefined;
  /** `Source/JavaScriptCore/aot`, of the checkout or of the prebuilt WebKit. The generators are files of it. */
  directory: string;
  schema: string;
  /** `aot/ir/generator/index.ts`. The engine has it, so that its own cmake build and this one run the same. */
  schemaGenerator: string;
  /** The schema's files and the generator's. */
  schemaInputs: string[];
  /** Where the C++ half goes. Undefined when the graph links a prebuilt WebKit, which was compiled with its own. */
  schemaGeneratedDirectory: string | undefined;
  schemaOutputs: string[];
  schemaUsers: string[];
  builtinsGeneratedDirectory: string;
  builtinTableInputs: string[];
  builtinTableOutputs: string[];
  /** The globals that the checkout is compiled without. The table has no entry at one or under it. */
  builtinsLeftOut: string[];
}

export type BuiltinTableTarget = "Darwin" | "Linux" | "Windows" | "FreeBSD" | "Android";

export function builtinTableTarget(cfg: Pick<CodegenFields, "os" | "abi">): BuiltinTableTarget {
  if (cfg.abi === "android") return "Android";
  switch (cfg.os) {
    case "darwin":
      return "Darwin";
    case "windows":
      return "Windows";
    case "freebsd":
      return "FreeBSD";
    case "linux":
      return "Linux";
  }
}

type CodegenDirectory = Pick<CodegenFields, "codegenDir">;

/** `ci` is no field of a `mode: "codegen"` graph, which has no engine either. */
const isCI = (cfg: CodegenFields): boolean => (cfg as Partial<Config>).ci === true;

export function removableFeaturesJson(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "removable-features.json");
}

export function builtinUsesJson(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "builtin-uses.json");
}

export function builtinTableRust(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "aot_builtin_table.rs");
}

export function engineFunctionsJson(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "aot_engine_functions.json");
}

/** One file for each crate that includes generated code. No change to the schema moves a name: a prebuilt engine is fetched after this graph is written. */
export function schemaRustFiles(cfg: CodegenDirectory): string[] {
  return ["aot_schema.rs", "aot_schema_builtins.rs", "aot_schema_interface.rs"].map(name =>
    resolve(cfg.codegenDir, name),
  );
}

export function schemaHashHeader(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "AOTSchemaHash.h");
}

export function schemaUseCheckStamp(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "aot-schema-names-are-used.stamp");
}

export function trimDirectory(cfg: Pick<CodegenFields, "cwd">): string {
  return resolve(cfg.cwd, "scripts", "build", "trim");
}

export function trimScript(cfg: Pick<CodegenFields, "cwd">, name: string): string {
  return resolve(trimDirectory(cfg), name);
}

export function registerAotRules(n: Ninja, cfg: Config): void {
  const q = (path: string) => quote(path, cfg.host.os === "windows");
  n.rule("aot_check", {
    command: `${cfg.jsRuntime} ${q(streamPath)} check --stamp=$out --cwd=$cwd ${q(cfg.bun)} $args`,
    description: "check $desc",
  });
}

function builtinsTableScript(cfg: Pick<CodegenFields, "cwd">, name: string): string {
  return resolve(cfg.cwd, "src", "codegen", "builtins", name);
}

/** The generators import the scripts with or without an engine. */
export function guardInputs({ cfg, engine }: Pick<Ctx, "cfg" | "engine">): string[] {
  return [
    removableFeaturesJson(cfg),
    resolve(cfg.cwd, "src", "codegen", "removable-entry-points.ts"),
    builtinsTableScript(cfg, "guards.ts"),
    builtinsTableScript(cfg, "paths.ts"),
    builtinsTableScript(cfg, "declarations.ts"),
    builtinsTableScript(cfg, "vocabulary.ts"),
    trimScript(cfg, "builtin-uses.ts"),
    trimScript(cfg, "features.ts"),
    trimScript(cfg, "types.ts"),
    resolve(cfg.cwd, "scripts", "build", "error.ts"),
    ...(engine === undefined ? [] : [builtinUsesJson(cfg)]),
  ];
}

/** `guardInputs` and what else src/codegen/create-hash-table.ts imports. */
export function hashTableInputs(ctx: Pick<Ctx, "cfg" | "engine">): string[] {
  return [...guardInputs(ctx), builtinsTableScript(ctx.cfg, "collect-static-tables.ts")];
}

/** None in a graph without an engine: nothing compiles the C++ it generates. Two of the scripts look for `--builtin-uses` last. */
export function builtinUsesArguments({ cfg, engine }: Pick<Ctx, "cfg" | "engine">): string[] {
  return engine === undefined
    ? []
    : [`--engine-directory=${engine.directory}`, `--builtin-uses=${builtinUsesJson(cfg)}`];
}

export function emitRemovableFeatures({ n, cfg, sources, o, dirStamp }: Ctx): void {
  const script = resolve(cfg.cwd, "src", "codegen", "generate-removable-features.ts");
  const rust = resolve(cfg.codegenDir, "removable_features.rs");
  const header = resolve(cfg.codegenDir, "BunRemovableFeatures.h");
  const outputs = [rust, header, removableFeaturesJson(cfg)];

  n.build({
    outputs,
    rule: "codegen_bun",
    inputs: [
      script,
      trimScript(cfg, "features.ts"),
      trimScript(cfg, "table-format.ts"),
      trimScript(cfg, "types.ts"),
      resolve(cfg.cwd, "scripts", "build", "error.ts"),
      resolve(cfg.cwd, "src", "codegen", "helpers.ts"),
      ...sources.removableFeatures,
    ],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "removable features",
      args: shJoin(cfg, ["run", script, cfg.cwd, cfg.codegenDir]),
    },
  });

  o.all.push(...outputs);
  o.rustInputs.push(rust);
  o.cppHeaders.push(header);
}

export function emitAotSchema({ n, cfg, o, dirStamp, engine }: Ctx): void {
  assert(engine !== undefined, "emitAotSchema needs an engine");
  const rust = schemaRustFiles(cfg);
  const header = schemaHashHeader(cfg);
  const outputs = [...engine.schemaOutputs, ...rust, header];
  n.build({
    outputs,
    rule: "codegen_bun",
    inputs: engine.schemaInputs,
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "AOTSchema.def",
      args: shJoin(cfg, [
        "run",
        engine.schemaGenerator,
        "--schema",
        engine.schema,
        "--rust-out",
        cfg.codegenDir,
        ...(engine.schemaGeneratedDirectory === undefined ? [] : ["--engine-out", engine.schemaGeneratedDirectory]),
      ]),
    },
  });
  o.all.push(...outputs);
  o.rustInputs.push(...rust);
  o.cppHeaders.push(header);
}

export function emitAotSchemaUseCheck({ n, cfg, sources, o, dirStamp, engine }: Ctx): void {
  assert(engine !== undefined, "emitAotSchemaUseCheck needs an engine");
  if (engine.javaScriptCore === undefined || !isCI(cfg)) return;
  const stamp = schemaUseCheckStamp(cfg);
  const usersOutsideAot = [
    resolve(engine.javaScriptCore, "b3", "B3Limits.h"),
    resolve(engine.javaScriptCore, "ffi", "JSFFICallback.cpp"),
    resolve(engine.javaScriptCore, "runtime", "AbstractModuleRecord.cpp"),
    resolve(cfg.cwd, "src", "bundler", "aot", "data_values.rs"),
    resolve(cfg.cwd, "src", "runtime", "cli", "compile_command", "reports.rs"),
  ];
  n.build({
    outputs: [stamp],
    rule: "aot_check",
    inputs: [...engine.schemaInputs, ...engine.schemaUsers, ...usersOutsideAot, ...sources.aotRust],
    orderOnlyInputs: [dirStamp, ...engine.schemaOutputs],
    vars: {
      cwd: cfg.cwd,
      desc: "uses of AOTSchema.def",
      args: shJoin(cfg, [
        "run",
        engine.schemaGenerator,
        "--schema",
        engine.schema,
        "--check-uses",
        resolve(engine.javaScriptCore, "aot"),
        "--check-uses",
        resolve(cfg.cwd, "src", "aot"),
        ...usersOutsideAot.flatMap(path => ["--check-uses", path]),
      ]),
    },
  });
  o.all.push(stamp);
}

export function emitBuiltinsTable({ n, cfg, sources, o, dirStamp, engine }: Ctx): void {
  assert(engine !== undefined, "emitBuiltinsTable needs an engine");
  const script = resolve(cfg.cwd, "src", "codegen", "builtins", "index.ts");
  const bindings = resolve(cfg.cwd, "src", "jsc", "bindings");
  const rust = [
    resolve(cfg.codegenDir, "aot_builtin_ids.rs"),
    builtinTableRust(cfg),
    resolve(cfg.codegenDir, "aot_builtin_syntax.rs"),
  ];
  const cpp = resolve(cfg.codegenDir, "BunAOTHostBindings.cpp");
  const tableHeader = resolve(cfg.codegenDir, "AOTBuiltinTableArrays.h");
  const table = ["Attachments", "Builtins", "Names", "Overloads", "Types"].map(part =>
    resolve(cfg.codegenDir, `AOTBuiltinTable${part}.cpp`),
  );
  const data = [
    builtinUsesJson(cfg),
    resolve(cfg.codegenDir, "aot_builtin_table.json"),
    resolve(cfg.codegenDir, "aot_builtin_undescribed_results.txt"),
    engineFunctionsJson(cfg),
  ];
  const outputs = [...rust, cpp, tableHeader, ...table, ...data, ...engine.builtinTableOutputs];

  n.build({
    outputs,
    rule: "codegen_bun",
    inputs: [
      script,
      ...sources.builtinsTableCodegen.filter(path => path !== script),
      ...sources.bindgen,
      ...sources.js,
      ...sources.jsCodegen,
      ...sources.aotPrelude,
      ...sources.nativeModuleLoadSites,
      ...sources.nativeCallSites,
      ...sources.removableFeatures,
      resolve(bindings, "ZigGlobalObject.lut.txt"),
      resolve(bindings, "JSBufferAccessors.def"),
      resolve(bindings, "ErrorCode.ts"),
      resolve(bindings, "js_classes.ts"),
      resolve(cfg.cwd, "src", "js", "builtins", "BunBuiltinNames.h"),
      resolve(cfg.cwd, "src", "resolve_builtins", "HardcodedModule.rs"),
      trimScript(cfg, "types.ts"),
      trimScript(cfg, "features.ts"),
      trimScript(cfg, "builtin-uses.ts"),
      resolve(cfg.cwd, "scripts", "build", "cmake.ts"),
      resolve(cfg.cwd, "scripts", "build", "error.ts"),
      resolve(cfg.cwd, "scripts", "glob-sources.ts"),
      ...engine.schemaInputs,
      ...engine.builtinTableInputs,
    ],
    implicitInputs: [o.rootInstall],
    orderOnlyInputs: [dirStamp],
    validations: engine.javaScriptCore === undefined || !isCI(cfg) ? [] : [schemaUseCheckStamp(cfg)],
    vars: {
      cwd: cfg.cwd,
      desc: "the table of built-ins",
      args: shJoin(cfg, [
        "run",
        script,
        `--codegen-path=${cfg.codegenDir}`,
        `--target=${builtinTableTarget(cfg)}`,
        `--sources=${sources.bindgen.map(src => `${crateOf(src)}=${src}`).join(",")}`,
        `--engine-directory=${engine.directory}`,
        ...(engine.javaScriptCore === undefined
          ? [`--prebuilt-generated=${engine.builtinsGeneratedDirectory}`]
          : [`--javascriptcore=${engine.javaScriptCore}`, `--engine-out=${engine.builtinsGeneratedDirectory}`]),
        ...(engine.builtinsLeftOut.length > 0 ? [`--left-out=${engine.builtinsLeftOut.join(",")}`] : []),
        typesOnlyFlag(cfg, sources),
      ]),
    },
  });

  o.all.push(...outputs);
  o.rustInputs.push(...rust);
  o.cppSources.push(cpp, ...table);
  o.builtinTableSources.push(...table);
  o.cppHeaders.push(tableHeader);
}

export function emitBuiltinSources({ n, cfg, sources, o, dirStamp, engine }: Ctx): void {
  assert(engine !== undefined, "emitBuiltinSources needs an engine");
  const script = resolve(cfg.cwd, "src", "codegen", "builtins-manifest.ts");
  const bindings = resolve(cfg.cwd, "src", "jsc", "bindings");
  const manifest = resolve(cfg.codegenDir, "builtins.manifest");
  const archive = resolve(cfg.codegenDir, "builtin_sources.bin");
  const bunTypes = resolve(cfg.cwd, "packages", "bun-types");

  n.build({
    outputs: [manifest, archive],
    rule: "codegen_bun",
    inputs: [
      script,
      ...sources.js,
      ...sources.jsCodegen,
      engineFunctionsJson(cfg),
      resolve(bindings, "ErrorCode.ts"),
      resolve(bindings, "js_classes.ts"),
      resolve(cfg.cwd, "src", "jsc", "modules", "NativeModuleList.h"),
      resolve(cfg.cwd, "src", "js", "tsconfig.json"),
      resolve(cfg.cwd, "tsconfig.base.json"),
      resolve(cfg.cwd, "src", "runtime.bun.js"),
      resolve(cfg.cwd, "src", "runtime.js"),
      ...readdirSync(bunTypes, { recursive: true, encoding: "utf8" })
        .filter(file => file.endsWith(".d.ts") && !file.includes("node_modules"))
        .sort()
        .map(file => resolve(bunTypes, file)),
      resolve(cfg.cwd, "bun.lock"),
    ],
    implicitInputs: [o.rootInstall],
    orderOnlyInputs: [dirStamp],
    vars: {
      cwd: cfg.cwd,
      desc: "builtin_sources.bin",
      args: shJoin(cfg, [
        "run",
        script,
        debugFlag(cfg),
        manifest,
        archive,
        `--engine-functions=${engineFunctionsJson(cfg)}`,
        `--engine-directory=${engine.directory}`,
      ]),
    },
  });

  o.all.push(manifest, archive);
  o.builtinSourcesArchive = archive;
}

/** ninja breaks scheduling ties by emission order. */
export function emitAotCodegen(ctx: Ctx): void {
  emitRemovableFeatures(ctx);
  if (ctx.engine === undefined) return;
  emitAotSchema(ctx);
  emitAotSchemaUseCheck(ctx);
  emitBuiltinsTable(ctx);
  emitBuiltinSources(ctx);
}
