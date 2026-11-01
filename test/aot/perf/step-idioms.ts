// The instructions that a turn of an idiom of ./idioms or ./everyday takes, built the way a user builds it, without a counter of the processor: ./count-steps.ts.
// Those in the code that the compiler made are the same on every run, but for what goes by an address, by chance or by what else the executable holds: 31 of 4,210 rows (./stepped-idioms.ts).
// Those in native code waver by some tens, with where the lists of free cells stand: they are printed and not judged.
//
//   bun test/aot/perf/step-idioms.ts <the Bun that builds> <where the numbers go, as JSON> [a pattern for the names] [called-once | in-a-very-large-program]
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunExe } from "harness";
import { availableParallelism, tmpdir } from "os";
import { join } from "path";
import { declare } from "../harness/capabilities";
import { forms, idiomsInExecutables, type Form, type Surroundings } from "./count-idioms";

/** A turn. */
export type Steps = { compiled: number; native: number };

/** A step takes some ten microseconds, and more on a busy machine. */
const stepsOfReading = 6000;
const mostTurns = 256;
/** A turn of more cannot be stepped through in the time of a test. */
export const mostStepsOfTurn = 300_000;

/** A container may forbid one process to watch another. */
export function whyNoSteps(bun: string) {
  if (process.platform !== "linux") return "./count-steps.ts watches a process the way Linux lets it";
  const { stderr, exitCode, signalCode } = Bun.spawnSync({ cmd: [bun, join(import.meta.dir, "count-steps.ts"), "/bin/true"], stdout: "ignore", stderr: "pipe", timeout: 60_000 });
  const said = stderr.toString();
  if (/^steps 0 compiled 0 marks 0$/m.test(said)) return undefined;
  const reason = /^error: (.*)$/m.exec(said)?.[1] ?? said.trim().split("\n").at(-1);
  return `./count-steps.ts watches no process here: ${reason || `it said nothing and ended with ${signalCode ?? `exit code ${exitCode}`}`}`;
}
declare("one process watches another", () => whyNoSteps(bunExe()));

export function steppedIdioms(bun: string, folder: string, chosen: (names: string[]) => string[], surroundings: Surroundings = "ordinary") {
  const { names, run, executableOf, start, startBuilds } = idiomsInExecutables(bun, folder, chosen, [], true, surroundings);

  async function stepsOf(name: string, form: Form, turns: number, padding: number) {
    const { stderr } = await run(folder, [bun, join(import.meta.dir, "count-steps.ts"), await executableOf(form, name)], {
      ...start(form, name, turns),
      AOT_PERF_MOST_STEPS: String(4 * mostStepsOfTurn),
      ...(padding ? { AOT_PERF_PADDING: "x".repeat(padding) } : {}),
    });
    const [, all, compiled, marks] = /^steps (\d+) compiled (\d+) marks (\d)$/m.exec(stderr) ?? [];
    if (all === undefined || (marks !== "2" && Number(all) <= 4 * mostStepsOfTurn)) throw new Error(`no steps: ${stderr.trim().slice(0, 300)}`);
    return { compiled: Number(compiled), native: Number(all) - Number(compiled), isWhole: marks === "2" };
  }

  /** The turns from `turns` to twice that of the long call. `padding`: so many bytes more in the environment, which nobody reads: whatever the process allocates lies elsewhere. */
  async function aTurn(name: string, form: Form, turns: number, padding = 0): Promise<Steps> {
    const [short, long] = await Promise.all([stepsOf(name, form, turns, padding), stepsOf(name, form, 2 * turns, padding)]);
    if (!short.isWhole || !long.isWhole) return { compiled: Infinity, native: Infinity };
    const each = (steps: number) => Math.round((100 * steps) / turns) / 100;
    return { compiled: each(long.compiled - short.compiled), native: each(long.native - short.native) };
  }

  /** So many that a reading takes about `stepsOfReading`. Undefined where one turn is too long. */
  async function turnsFor(name: string) {
    const { compiled, native } = await aTurn(name, "untyped", 1);
    if (compiled + native > mostStepsOfTurn) return undefined;
    return Math.min(mostTurns, Math.max(1, Math.ceil(stepsOfReading / Math.max(1, compiled + native))));
  }

  return { names, aTurn, turnsFor, startBuilds };
}

if (import.meta.main) {
  const [bun, out, pattern = ".", surroundings = "ordinary"] = process.argv.slice(2);
  const folder = join(process.env.TMPDIR ?? tmpdir(), `step-idioms-${process.pid}`);
  mkdirSync(folder, { recursive: true });
  const { names, aTurn, turnsFor } = steppedIdioms(bun, folder, all => all.filter(name => new RegExp(pattern).test(name)), surroundings as Surroundings);
  const result: Record<string, Partial<Record<Form, Steps>> & { turns?: number; failure?: string }> = {};
  const waiting = [...names];
  const began = performance.now();
  await Promise.all(
    Array.from({ length: Number(process.env.AOT_PROGRAMS_JOBS) || availableParallelism() }, async () => {
      for (let name = waiting.shift(); name; name = waiting.shift()) {
        try {
          const turns = await turnsFor(name);
          result[name] = turns === undefined ? {} : { turns, typed: await aTurn(name, "typed", turns), untyped: await aTurn(name, "untyped", turns) };
        } catch (error) {
          result[name] = { failure: (error as Error).message };
        }
      }
    }),
  );
  writeFileSync(out, `{\n${Object.keys(result).sort().map(name => `${JSON.stringify(name)}: ${JSON.stringify(result[name])}`).join(",\n")}\n}\n`);
  rmSync(folder, { recursive: true, force: true });
  console.log(`${names.length} idioms, ${Object.values(result).filter(row => row.failure).length} failed, ${Object.values(result).filter(row => !row.failure && !row.turns).length} too long, ${Math.round((performance.now() - began) / 1000)} s`);
}
