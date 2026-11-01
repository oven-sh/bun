// The instructions that one site of a row of ./operations/generate.py takes in the code that the compiler made, without a counter of the processor: ./count-steps.ts.
// ./operations.measure.ts says what a row is, and counts the same with a counter, over hundreds of thousands of calls, with what Bun and the C library take.
//
//   instructions a site = (those of c calls of the function with 12 sites - those of c calls of the one with 4) / (8 c)
//
// each as the difference of a run of 2 c calls and a run of c, so that what the first calls fill cancels out.
//
//   bun test/aot/perf/step-operations.ts <the Bun that builds> <where the numbers go, as JSON> [a pattern for the names]
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { join } from "path";

export const columns = ["alone", "opened"] as const;
export type Column = (typeof columns)[number];

const mark = 'process.kill(process.pid, "SIGUSR2")';
/** The program sends itself a signal in front of the calls and behind them, for ./count-steps.ts. */
function withMarks(text: string, path: string) {
  const marked = text
    .replace("if (chosen !== undefined) console.log(ROW, chosen(COUNT), CALLS); else ", `if (chosen !== undefined) { ${mark}; const v = chosen(COUNT); ${mark}; console.log(ROW, v, CALLS); } else `)
    .replace(
      "if (chosenAsync !== undefined) chosenAsync(COUNT).then((v: number): void => { console.log(ROW, v, CALLS); }); else ",
      `if (chosenAsync !== undefined) { ${mark}; chosenAsync(COUNT).then((v: number): void => { ${mark}; console.log(ROW, v, CALLS); }); } else `,
    );
  if (marked === text) throw new Error(`${path} does not end as ./operations/generate.py wrote it`);
  return marked;
}

export function steppedOperations(bun: string, folder: string, python: string) {
  writeFileSync(join(folder, "tsconfig.json"), JSON.stringify({ extends: join(import.meta.dir, "operations", "tsconfig.json") }));
  const generated = Bun.spawnSync({ cmd: [python, join(import.meta.dir, "operations", "generate.py"), folder], stdout: "ignore", stderr: "pipe" });
  if (generated.exitCode !== 0) throw new Error(`generate.py ended with ${generated.exitCode}:\n${generated.stderr}`);
  // name, group, the row whose cost is contained in this one, does a site take long, is it written in TypeScript | Go | C++, .., what it is
  const rows = readFileSync(join(folder, "rows.tsv"), "utf8")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(fields => fields[4] === "1")
    .map(fields => ({ name: fields[0], isHeavy: fields[3] === "1", what: fields.at(-1)! }));
  for (const column of columns)
    for (const { name } of rows) {
      const path = join(folder, column, `${name}.ts`);
      writeFileSync(path, withMarks(readFileSync(path, "utf8"), path));
    }
  // A collection drops what the run time has learned about some places, and when one comes depends on the clock.
  const environment = {
    PATH: process.env.PATH,
    HOME: folder,
    TMPDIR: folder,
    NO_COLOR: "1",
    BUN_ENABLE_CRASH_REPORTING: "0",
    DO_NOT_TRACK: "1",
    BUN_GC_TIMER_DISABLE: "1",
    BUN_JSC_percentCPUPerMBForEdenTimer: "0",
    BUN_JSC_percentCPUPerMBForFullTimer: "0",
    BUN_JSC_smallHeapSize: "2000000000",
    BUN_JSC_largeHeapSize: "2000000000",
  };
  async function run(cmd: string[], extra: Record<string, string> = {}) {
    await using child = Bun.spawn({ cmd, cwd: folder, env: { ...environment, ...extra }, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 900_000, killSignal: "SIGKILL" });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    if (exitCode !== 0) throw new Error(`exit code ${exitCode}${child.signalCode ? ", " + child.signalCode : ""}: ${(stderr + stdout).trim().split("\n").slice(0, 3).join(" / ").slice(0, 300)}`);
    return { stdout, stderr };
  }

  const built = new Map<string, Promise<string>>();
  function executableOf(column: Column, name: string) {
    const executable = join(folder, `${column}-${name}`);
    if (!built.has(executable)) built.set(executable, run([bun, "build", "--compile", "--aot", join(folder, column, `${name}.ts`), "--outfile", executable]).then(() => executable));
    return built.get(executable)!;
  }

  /** `padding`: so many bytes more in the environment, which nobody reads: whatever the process allocates lies elsewhere. */
  async function aSite(column: Column, { name, isHeavy }: { name: string; isHeavy: boolean }, padding = 0) {
    const executable = await executableOf(column, name);
    const calls = isHeavy ? 8 : 64;
    const stepsOf = async (sites: number, calls: number) => {
      const { stderr } = await run([bun, join(import.meta.dir, "count-steps.ts"), executable, `${name}_${sites}`, String(calls), "2", "lit_zz", "DELETE", "PATCH"], padding ? { AOT_PERF_PADDING: "x".repeat(padding) } : {});
      const [, compiled, marks] = /^steps \d+ compiled (\d+) marks (\d)$/m.exec(stderr) ?? [];
      if (marks !== "2") throw new Error(`no steps: ${stderr.trim().slice(0, 300)}`);
      return Number(compiled);
    };
    const [few4, many4, few12, many12] = await Promise.all([stepsOf(4, calls), stepsOf(4, 2 * calls), stepsOf(12, calls), stepsOf(12, 2 * calls)]);
    return Math.round((100 * (many12 - few12 - (many4 - few4))) / 8 / calls) / 100;
  }
  const remove = (column: Column, name: string) => rmSync(join(folder, `${column}-${name}`), { force: true });

  return { rows, aSite, remove };
}

if (import.meta.main) {
  const [bun, out, pattern = "."] = process.argv.slice(2);
  const folder = join(process.env.TMPDIR ?? tmpdir(), `step-operations-${process.pid}`);
  mkdirSync(folder, { recursive: true });
  const { rows, aSite, remove } = steppedOperations(bun, folder, Bun.which("python3")!);
  const result: Record<string, Partial<Record<Column, number>> & { failure?: string }> = {};
  const waiting = rows.filter(row => new RegExp(pattern).test(row.name)).flatMap(row => columns.map(column => ({ row, column })));
  const began = performance.now();
  await Promise.all(
    Array.from({ length: Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism() }, async () => {
      for (let next = waiting.shift(); next; next = waiting.shift()) {
        const { row, column } = next;
        try {
          (result[row.name] ??= {})[column] = await aSite(column, row);
        } catch (error) {
          (result[row.name] ??= {}).failure = `${column}: ${(error as Error).message}`;
        }
        remove(column, row.name);
      }
    }),
  );
  writeFileSync(out, `{\n${Object.keys(result).sort().map(name => `${JSON.stringify(name)}: ${JSON.stringify(result[name])}`).join(",\n")}\n}\n`);
  rmSync(folder, { recursive: true, force: true });
  console.log(`${Object.keys(result).length} rows, ${Object.values(result).filter(row => row.failure).length} failed, ${Math.round((performance.now() - began) / 1000)} s`);
}
