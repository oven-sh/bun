import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../harness/run";
import type { CompiledFunction, Counted, Request } from "../instruction-counts/count-instructions";

export type Level = "unknown" | "guarded" | "proven";
export type SiteKind = "read" | "store" | "define" | "has" | "delete" | "call" | "construct";

interface Position {
  file: string;
  line: number;
  column: number;
}

interface FunctionRecord extends Position {
  name: string;
  role: string;
  codeBytes: number;
  operations: Record<string, number>;
}

interface AccessSite extends Position {
  kind: SiteKind;
  level: Level;
  function: number | null;
}

export interface Report {
  functions: FunctionRecord[];
  accessSites: AccessSite[];
  typeTestSites: (Position & { function: number | null })[];
  statistics: Record<string, number>;
}

export const readReport = (path: string): Report => JSON.parse(readFileSync(path, "utf8"));

const isNamed = (record: FunctionRecord, names: string[]) =>
  names.includes(record.name) && record.file !== "" && !record.file.startsWith("..");

// The report lists operators on values of unknown type too. The rows are about accesses to properties and about calls.
const kindsOfRows = ["read", "store", "define", "has", "delete", "call", "construct"];

export function sitesOf(report: Report, names: string[]): string[] {
  const written = new Set(
    report.functions.flatMap((record, index) => (isNamed(record, names) && record.role === "Source" ? [index] : [])),
  );
  return report.accessSites
    .filter(site => site.function !== null && written.has(site.function) && kindsOfRows.includes(site.kind))
    .sort((a, b) => a.line - b.line || a.column - b.column)
    .map(site => `${site.kind} ${site.level}`);
}

export function operationsOf(report: Report, names: string[]): Record<string, number> {
  const operations: Record<string, number> = {};
  for (const record of report.functions) {
    if (!isNamed(record, names)) continue;
    for (const [operation, count] of Object.entries(record.operations))
      operations[operation] = (operations[operation] ?? 0) + count;
  }
  return operations;
}

export function functionsOf(map: string): CompiledFunction[] {
  const functions: CompiledFunction[] = [];
  for (const line of map.split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F") {
      const isApplication = fields[10].startsWith("/$bunfs/root/") || fields[10].startsWith("B:\\\\~BUN\\\\root\\\\");
      const name =
        fields[8] === "entry" || fields[8] === "module" ? "module code" : fields[7] || "a function without a name";
      functions.push({
        offset: Number(fields[2]),
        size: Number(fields[3]),
        name: isApplication ? name : "built-in modules",
      });
    } else if (fields[0] === "T") {
      functions.push({
        offset: Number(fields[1]),
        size: -1,
        name: fields[2].startsWith("outlined ") ? "outlined code" : `stub ${fields[2]}`,
      });
    }
  }
  functions.sort((a, b) => a.offset - b.offset);
  functions.forEach((compiled, index) => {
    if (compiled.size < 0) compiled.size = (functions[index + 1]?.offset ?? compiled.offset) - compiled.offset;
  });
  return functions;
}

export const turns = { before: [20, 20], fewer: 5, more: 15 };

export interface Turn {
  compiled: number;
  outside: number;
  stubs: string[];
  shares: string[];
  stdout: string;
}

const instructionsOfStubThatCounts = 50;
const isOutsideCompiledCode = (where: string) => where === "the runtime" || where === "elsewhere";

export async function countTurn(
  bun: string,
  executable: string,
  functions: CompiledFunction[],
  name: string,
  env: Record<string, string | undefined>,
): Promise<Turn> {
  const request: Request = {
    command: [executable, name, ...[...turns.before, turns.fewer, turns.more].map(String)],
    env: { ...env, BUN_JSC_useGC: "0" },
    marksBeforeTheFirstWindow: turns.before.length,
    numberOfWindows: 2,
    functions,
  };
  await using child = Bun.spawn({
    cmd: [bun, join(import.meta.dir, "..", "instruction-counts", "count-in-a-child.ts")],
    env,
    stdin: new Blob([JSON.stringify(request)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  if (exitCode) throw new Error(`${name}: ${stderr.trim()}`);
  const counted: Omit<Counted, "windows"> & { windows: [string, number][][] } = JSON.parse(stdout);
  if (counted.exitCode) throw new Error(`${name}: exit code ${counted.exitCode}\n${counted.stderr}`);
  const [few, many] = counted.windows.map(window => new Map(window));
  const perTurn = [...new Set([...few.keys(), ...many.keys()])]
    .map(where => ({
      where,
      instructions: ((many.get(where) ?? 0) - (few.get(where) ?? 0)) / (turns.more - turns.fewer),
    }))
    .filter(share => Math.abs(share.instructions) >= 0.5)
    .sort((a, b) => b.instructions - a.instructions || (a.where < b.where ? -1 : 1));
  const sum = (shares: typeof perTurn) => Math.round(shares.reduce((total, share) => total + share.instructions, 0));
  return {
    compiled: sum(perTurn.filter(share => !isOutsideCompiledCode(share.where))),
    outside: sum(perTurn.filter(share => isOutsideCompiledCode(share.where))),
    stubs: perTurn
      .filter(share => share.where.startsWith("stub ") && share.instructions >= instructionsOfStubThatCounts)
      .map(share => share.where.slice(5))
      .sort(),
    shares: perTurn.map(share => `${share.where} ${Math.round(share.instructions)}`),
    stdout: counted.stdout,
  };
}

export async function countOperations(
  executable: string,
  name: string,
  rounds: number,
  countsPath: string,
  env: Record<string, string | undefined>,
) {
  const { stdout, stderr, exitCode } = await run([executable, name, String(rounds)], undefined, {
    ...env,
    BUN_DESTRUCT_VM_ON_EXIT: "1",
    BUN_JSC_aotCountsPath: countsPath,
  });
  if (exitCode) throw new Error(`${name}: exit code ${exitCode}\n${stderr}`);
  const counts = new Map<string, number>();
  for (const line of readFileSync(countsPath, "utf8").split("\n")) {
    const [count, operation] = line.split("\toperation:");
    if (operation !== undefined) counts.set(operation, Number(count));
  }
  return { counts, stdout };
}

export async function operationsOfTurn(
  executable: string,
  name: string,
  countsPath: string,
  env: Record<string, string | undefined>,
): Promise<string[]> {
  const few = await countOperations(executable, name, 50, countsPath + "-few", env);
  const many = await countOperations(executable, name, 250, countsPath + "-many", env);
  return [...many.counts]
    .map(([operation, count]) => ({ operation, calls: (count - (few.counts.get(operation) ?? 0)) / 200 }))
    .filter(({ calls }) => calls >= 0.5)
    .sort((a, b) => b.calls - a.calls || (a.operation < b.operation ? -1 : 1))
    .map(({ operation, calls }) => `${operation} ${Math.round(calls)}`);
}

function functionsNamedBy(texts: Map<string, string>, start: string): string[] {
  const found = [start];
  for (const name of found) {
    for (const [, other] of (texts.get(name) ?? "").matchAll(/\b(\w+)(?:\.call|\.apply)?\(/g))
      if (texts.has(other) && !found.includes(other)) found.push(other);
  }
  return found;
}

const operationsOfFastPaths = [
  "GetSlot",
  "PutSlot",
  "PutSlots",
  "GetArrayElement",
  "PutArrayElement",
  "GetArrayLength",
  "GetStringLength",
  "GetStringCodeUnit",
  "CallInline",
  "CallDirect",
  "IsClosureOf",
  "IsPristine",
  "BelongsToInstance",
  "ShapeTest",
  "HasKeyOrder",
  "HasInPrototypeChain",
  "TypeTest",
];

if (import.meta.main) {
  const [folder, reportPath, mapPath, executable, bun, wanted = ""] = process.argv.slice(2);
  if (!bun) {
    console.error(
      "usage: bun look.ts <folder of the project> <report.json> <main.map> <executable> <bun> [<part of a case's name>]",
    );
    process.exit(1);
  }
  const report = readReport(reportPath);
  const functions = functionsOf(readFileSync(mapPath, "utf8"));
  const env = { ...process.env, NO_COLOR: "1" };
  const texts = new Map<string, string>();
  const turnOfCase = new Map<string, string>();
  for (const file of readdirSync(folder).filter(file => /\.[jt]s$/.test(file) && !file.endsWith(".d.ts"))) {
    const text = readFileSync(join(folder, file), "utf8");
    for (const [whole, name] of text.matchAll(/^function (\w+)[(<][^]*?^\}$/gm))
      texts.set(name, whole.slice(whole.indexOf("{")));
    for (const [, name, turn] of text.matchAll(/^  "([^"]+)":\s+(?:\{[^]*?\bturn: )?(\w+)/gm))
      turnOfCase.set(name, turn);
  }
  console.log(
    `// statistics: ${JSON.stringify(Object.fromEntries(Object.entries(report.statistics).filter(([name]) => /^KnownHelper/.test(name))))}`,
  );
  const names = Bun.spawnSync({ cmd: [executable, "names"], env })
    .stdout.toString()
    .split("\n")
    .filter(Boolean);
  const printed: string[] = [];
  const waiting = names.filter(name => name.includes(wanted)).map((name, index) => ({ name, index }));
  const worker = async () => {
    for (let next = waiting.shift(); next; next = waiting.shift()) {
      const { name, index } = next;
      try {
        const turn = await countTurn(bun, executable, functions, name, env);
        const calls = await operationsOfTurn(executable, name, join(executable, "..", `counts-${index}`), env);
        const start = turnOfCase.get(name)!;
        const subjects = functionsNamedBy(texts, start).flatMap(subject =>
          subject === start && /^\{[^]*\breturn function turnOf/.test(texts.get(start)!)
            ? ["turnOf" + start[0].toUpperCase() + start.slice(1)]
            : [subject],
        );
        const operations = operationsOf(report, subjects);
        const row = {
          evidence: "",
          case: name,
          functions: subjects,
          sites: sitesOf(report, subjects),
          operations: operationsOfFastPaths.filter(operation => operations[operation]),
          compiled: turn.compiled,
          outside: turn.outside,
          stubs: turn.stubs,
          calls,
        };
        printed[index] = `${JSON.stringify(row)}\n    // ${turn.stdout.trim()} | ${turn.shares.join(", ")}`;
      } catch (error) {
        printed[index] = JSON.stringify({ case: name, error: String(error).slice(0, 300) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || 1) }, worker));
  console.log(printed.join("\n"));
}
