import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { writeIfChanged } from "./fs.ts";

const compilerDirectories = [
  "codegen",
  "stubs",
  "builtins",
  "select",
  "image",
  "place",
  "represent",
  "passes",
  "object",
];
const factsFile = "aot/image/AOTRuntimeFactsOfLayouts.def";
const includesFile = "aot/image/AOTRuntimeFactsOfLayoutsIncludes.h";
const leftOutFile = "aot/image/AOTRuntimeFactsLeftOut.txt";

const className = String.raw`((?:[A-Za-z_]\w*::)*[A-Za-z_]\w*(?:<[\w:, ]+>)?(?:::[A-Za-z_]\w*)*)`;
const patterns: {
  pattern: RegExp;
  expression: (match: RegExpMatchArray) => string;
  owner: (match: RegExpMatchArray) => string;
}[] = [
  {
    pattern: new RegExp(String.raw`\b${className}::(offsetOf\w*|\w+Offset)\(\)`, "g"),
    expression: match => `${match[1]}::${match[2]}()`,
    owner: match => match[1]!,
  },
  {
    pattern: /\bOBJECT_OFFSETOF\(\s*([^(),]+?)\s*,\s*([\w.[\]]+)\s*\)/g,
    expression: match => `OBJECT_OFFSETOF(${match[1]}, ${match[2]})`,
    owner: match => match[1]!,
  },
  {
    pattern: /\b(AOT_INSTANCE_(?:PREFIX_)?OFFSET)\(\s*([\w.[\]]+)\s*\)/g,
    expression: match => `${match[1]}(${match[2]})`,
    owner: () => "Instance",
  },
];

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function filesUnder(directory: string, isWanted: (path: string) => boolean): string[] {
  const found: string[] = [];
  const pending = [directory];
  for (const current of pending) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (isWanted(path)) found.push(path);
    }
  }
  return found.sort(byCodeUnit);
}

function isCompilerSource(path: string): boolean {
  const name = basename(path);
  return (
    /\.(cpp|h)$/.test(name) &&
    !name.includes("Test") &&
    !name.startsWith("AOTRuntimeFact") &&
    !name.startsWith("AOTRuntimeDescription") &&
    !path.replaceAll("\\", "/").includes("/generated/")
  );
}

export interface RuntimeFacts {
  facts: string;
  includes: string;
}

interface ConditionalFrame {
  earlierArms: string[];
  arm: string | null;
}

const allOf = (conditions: string[]): string =>
  conditions.length === 1 ? conditions[0]! : conditions.map(condition => `(${condition})`).join(" && ");
const conditionOf = (frame: ConditionalFrame): string =>
  allOf([...frame.earlierArms.map(arm => `!(${arm})`), ...(frame.arm === null ? [] : [frame.arm])]);

function forEachLineWithGuard(text: string, visit: (line: string, guard: string) => void): void {
  const frames: ConditionalFrame[] = [];
  for (const line of text.split("\n")) {
    const directive = /^\s*#\s*(if|ifdef|ifndef|elif|else|endif)\b\s*(.*?)\s*(?:\/\/.*)?$/.exec(line);
    if (!directive) {
      const conditions = frames.map(conditionOf).filter(condition => condition !== "ENABLE(AOT)");
      visit(line, conditions.length ? allOf(conditions) : "");
      continue;
    }
    const [, kind, rest] = directive;
    const top = frames.at(-1);
    if (kind === "if") frames.push({ earlierArms: [], arm: rest! });
    else if (kind === "ifdef") frames.push({ earlierArms: [], arm: `defined(${rest})` });
    else if (kind === "ifndef") frames.push({ earlierArms: [], arm: `!defined(${rest})` });
    else if (kind === "endif") frames.pop();
    else if (top) {
      if (top.arm !== null) top.earlierArms.push(top.arm);
      top.arm = kind === "elif" ? rest! : null;
    }
  }
}

export function collectRuntimeFacts(javaScriptCore: string): RuntimeFacts {
  const leftOutPath = join(javaScriptCore, leftOutFile);
  const leftOut = new Set(
    (existsSync(leftOutPath) ? readFileSync(leftOutPath, "utf8") : "")
      .split("\n")
      .filter(line => line && !line.startsWith("#"))
      .map(line => line.split(" | ")[0]!),
  );
  const owners = new Map<string, string>();
  const guards = new Map<string, Set<string>>();
  for (const directory of compilerDirectories) {
    for (const file of filesUnder(join(javaScriptCore, "aot", directory), isCompilerSource)) {
      forEachLineWithGuard(readFileSync(file, "utf8"), (line, guard) => {
        for (const { pattern, expression, owner } of patterns) {
          for (const match of line.matchAll(pattern)) {
            const text = expression(match);
            if (leftOut.has(text)) continue;
            owners.set(text, owner(match));
            if (!guards.has(text)) guards.set(text, new Set());
            guards.get(text)!.add(guard);
          }
        }
      });
    }
  }
  const headers = new Set(filesUnder(javaScriptCore, path => path.endsWith(".h")).map(path => basename(path)));
  const includes = new Set<string>();
  for (const owner of owners.values()) {
    for (const part of owner.replace(/<.*/, "").split("::")) {
      for (const header of [`${part}.h`, `AOT${part}.h`]) if (headers.has(header)) includes.add(header);
    }
  }
  const byGuard = new Map<string, string[]>();
  for (const text of [...owners.keys()].sort(byCodeUnit)) {
    const seen = guards.get(text)!;
    const guard = seen.has("")
      ? ""
      : [...seen]
          .sort(byCodeUnit)
          .map(one => (seen.size > 1 ? `(${one})` : one))
          .join(" || ");
    if (!byGuard.has(guard)) byGuard.set(guard, []);
    byGuard.get(guard)!.push(`AOT_RUNTIME_FACT("${text}", static_cast<uint32_t>(${text}))\n`);
  }
  const head = "// Written by scripts/build/aot-runtime-facts.ts in Bun's tree. Do not edit.\n";
  const blocks = [...byGuard.keys()].sort(byCodeUnit).map(guard => {
    const lines = byGuard.get(guard)!.join("");
    return guard ? `#if ${guard}\n${lines}#endif\n` : lines;
  });
  return {
    facts: head + blocks.join(""),
    includes:
      head +
      [...includes]
        .sort(byCodeUnit)
        .map(header => `#include "${header}"\n`)
        .join(""),
  };
}

export function findRuntimeFactProblems(javaScriptCore: string): string[] {
  const { facts, includes } = collectRuntimeFacts(javaScriptCore);
  const isStale = (file: string, text: string) =>
    !existsSync(join(javaScriptCore, file)) || readFileSync(join(javaScriptCore, file), "utf8") !== text;
  return [
    ...(isStale(factsFile, facts) ? [factsFile] : []),
    ...(isStale(includesFile, includes) ? [includesFile] : []),
  ];
}

if (import.meta.main) {
  const webkit =
    process.argv.find(argument => argument.startsWith("--webkit="))?.slice("--webkit=".length) ??
    process.env.BUN_WEBKIT_PATH ??
    "vendor/WebKit";
  const javaScriptCore = resolve(webkit, "Source/JavaScriptCore");
  if (process.argv.includes("--check")) {
    const problems = findRuntimeFactProblems(javaScriptCore);
    for (const file of problems) console.error(`${file} is stale: bun scripts/build/aot-runtime-facts.ts writes it`);
    process.exit(problems.length ? 1 : 0);
  }
  const { facts, includes } = collectRuntimeFacts(javaScriptCore);
  writeIfChanged(join(javaScriptCore, factsFile), facts);
  writeIfChanged(join(javaScriptCore, includesFile), includes);
}
