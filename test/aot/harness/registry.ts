import { bunEnv, bunExe } from "harness";
import { buildFlags } from "./flags";

export type LimitPurpose = "compileTime" | "codeSize" | "bitWidth";

export interface LimitDeclaration {
  name: string;
  value: number;
  stage: string;
  protects: LimitPurpose;
  degradesTo: string;
}

export interface PassDeclaration {
  name: string;
  isOptional: boolean;
}

export interface Registry {
  schemaHash: string;
  limits: LimitDeclaration[];
  statistics: string[];
  runtimeCounters: string[];
  flowResults: string[];
  passes: PassDeclaration[];
  operations: string[];
  features: string[];
  /** The faults that `--aot-sabotage=<name>` puts into a build on purpose. Not listed by a Bun that has none. */
  sabotages?: string[];
}

let cached: Registry | undefined;

export function registry(): Registry {
  if (cached) return cached;
  const listed = Bun.spawnSync({ cmd: [bunExe(), "compile", buildFlags.listRegistry], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  if (listed.exitCode !== 0) throw new Error(`bun compile ${buildFlags.listRegistry} exited with ${listed.exitCode}:\n${listed.stderr}`);
  return (cached = JSON.parse(listed.stdout.toString()));
}

export type RegistryList = "statistics" | "runtimeCounters" | "flowResults" | "operations" | "features";

export function isDeclared(list: RegistryList, name: string): boolean {
  return registry()[list].includes(name);
}

export function findLimit(name: string): LimitDeclaration | undefined {
  return registry().limits.find(limit => limit.name === name);
}
