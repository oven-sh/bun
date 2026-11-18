import { resolve } from "node:path";
import { shJoin, type Ctx } from "./codegen.ts";
import type { CodegenFields } from "./config.ts";

type CodegenDirectory = Pick<CodegenFields, "codegenDir">;

export function removableFeaturesJson(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "removable-features.json");
}

/** What the trimmable link reads of the table of built-ins. No step writes it: see `Config.trimmable`. */
export function builtinUsesJson(cfg: CodegenDirectory): string {
  return resolve(cfg.codegenDir, "builtin-uses.json");
}

export function trimDirectory(cfg: Pick<CodegenFields, "cwd">): string {
  return resolve(cfg.cwd, "scripts", "build", "trim");
}

export function trimScript(cfg: Pick<CodegenFields, "cwd">, name: string): string {
  return resolve(trimDirectory(cfg), name);
}

/** What a generator that can print guards of removable features imports. */
export function guardInputs(cfg: CodegenFields): string[] {
  return [
    removableFeaturesJson(cfg),
    resolve(cfg.cwd, "src", "codegen", "removable-entry-points.ts"),
    resolve(cfg.cwd, "src", "codegen", "builtins", "guards.ts"),
    resolve(cfg.cwd, "src", "codegen", "builtins", "paths.ts"),
    trimScript(cfg, "builtin-uses.ts"),
    trimScript(cfg, "features.ts"),
    trimScript(cfg, "types.ts"),
    resolve(cfg.cwd, "scripts", "build", "error.ts"),
  ];
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
