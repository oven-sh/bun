import { existsSync } from "node:fs";
import path from "node:path";
import { functionsOfUnit, readUnit, type FoundFunction } from "../definitions.ts";
import { isNameOfProbe, probes } from "../probes.ts";

const targetNames = [
  "ES3",
  "ES5",
  "ES6",
  "ES2015",
  "ES2016",
  "ES2017",
  "ES2018",
  "ES2019",
  "ES2020",
  "ES2021",
  "ES2022",
  "ES2023",
  "ES2024",
  "ES2025",
  "ESNext",
];
const moduleNames = ["CommonJS", "ES6", "ES2015"];

function membersOf(enumeration: Record<string, number>, names: readonly string[]): [string, number][] {
  const seen = new Set<number>();
  const members: [string, number][] = [];
  for (const name of names) {
    const value = enumeration[name];
    if (value === undefined || seen.has(value)) continue;
    seen.add(value);
    members.push([name, value]);
  }
  return members;
}

export interface Emitted {
  readonly where: string;
  readonly text: string;
}

export function loadTypeScript(folder: string): any {
  const file = ["lib/typescript.js", "bin/typescript.js"].map(name => path.join(folder, name)).find(existsSync);
  return file === undefined ? undefined : require(file);
}

export function transpile(ts: any, text: string, fileName: string, compilerOptions: object): string | undefined {
  try {
    if (ts.transpileModule) return ts.transpileModule(text, { compilerOptions, fileName }).outputText;
    return ts.transpile(text, compilerOptions, fileName);
  } catch {
    return undefined;
  }
}

export function emitProbes(ts: any): Emitted[] {
  const emitted: Emitted[] = [];
  const seen = new Set<string>();
  for (const probe of probes) {
    for (const [target, targetValue] of membersOf(ts.ScriptTarget, targetNames)) {
      for (const [module, moduleValue] of membersOf(ts.ModuleKind, moduleNames)) {
        for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
          const downlevelIteration = (flags & 1) !== 0;
          const experimentalDecorators = (flags & 2) !== 0;
          const useDefineForClassFields = (flags & 4) !== 0;
          const text = transpile(ts, probe.text, `${probe.name}.${probe.hasJsx ? "tsx" : "ts"}`, {
            target: targetValue,
            module: moduleValue,
            esModuleInterop: true,
            downlevelIteration,
            experimentalDecorators,
            emitDecoratorMetadata: experimentalDecorators,
            useDefineForClassFields,
            rewriteRelativeImportExtensions: true,
            jsx: ts.JsxEmit?.React,
            newLine: ts.NewLineKind?.LineFeed,
          });
          if (text === undefined || seen.has(text)) continue;
          seen.add(text);
          const options: string[] = [];
          if (downlevelIteration) options.push("--downlevelIteration");
          if (experimentalDecorators) options.push("--experimentalDecorators --emitDecoratorMetadata");
          if (useDefineForClassFields) options.push("--useDefineForClassFields");
          options.push(`--target ${target}`, `--module ${module}`);
          emitted.push({ where: `${probe.name} ${options.join(" ")}`, text });
        }
      }
    }
  }
  return emitted;
}

export function readTypeScript(folder: string): FoundFunction[] {
  const ts = loadTypeScript(folder);
  if (ts === undefined) return [];
  const found: FoundFunction[] = [];
  for (const { where, text } of emitProbes(ts)) {
    const unit = readUnit(where, text);
    if (unit !== undefined) found.push(...functionsOfUnit(unit, name => !isNameOfProbe(name)));
  }
  return found;
}
