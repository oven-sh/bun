// An opt-in performance test. Each program under ./idioms runs one everyday JavaScript idiom in a loop. The test measures how
// many instructions one iteration takes when the program is compiled ahead of time, once as TypeScript and once as the same
// program without type annotations. Plain Bun with its JIT is measured for comparison and is never judged.
//
//   AOT_PERF=1 bun test test/aot/perf/idioms.test.ts        fails if a compiled form takes more than 10% AND more than 20
//                                                           instructions per iteration more than ./pins.<os>-<arch>.json says,
//                                                           or more than 25% AND more than 4 instructions more
//   AOT_PERF=update bun test test/aot/perf/idioms.test.ts   rewrites the pinned numbers, each as soon as it is measured, so
//                                                           an interrupted run leaves the others unchanged
//   AOT_PERF_ONLY='^(spread|rest)/' ..                      only the idioms whose path matches the regular expression
//
// Without AOT_PERF, or where `perf` is not installed, everything is skipped. Instructions are counted with
// `perf stat -e instructions:u` around the whole process. The cost of one iteration is the difference between a run of n
// iterations and a run of n / 4, divided by 3n / 4, so that start-up and warm-up cancel out. turns.json has n for each idiom.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join, relative } from "path";

const root = join(import.meta.dir, "idioms");
const pinsPath = join(import.meta.dir, `pins.${process.platform}-${process.arch}.json`);
const mode = process.env.AOT_PERF;
const perf = Bun.which("perf");

type Forms = { typed: number; untyped: number; jit: number };
const pins: Record<string, Forms> = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
const turns: Record<string, number> = JSON.parse(readFileSync(join(import.meta.dir, "turns.json"), "utf8"));
const measured: Record<string, Forms> = {};

const idioms = readdirSync(root, { recursive: true })
  .map(String)
  .filter(path => path.endsWith(".ts") && path !== "host.ts")
  .map(path => path.slice(0, -3))
  .filter(name => new RegExp(process.env.AOT_PERF_ONLY ?? "").test(name))
  .sort();

async function spawned(cmd: string[], env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd: root, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.skipIf(!mode || !perf)("compile/aot/perf/idioms", () => {
  const folder = tempDir("aot-perf", {});
  console.log(["instructions per iteration".padEnd(64), "typed", "untyped", "JIT"].join("\t"));

  async function instructions(cmd: string[], n: number) {
    const report = join(String(folder), "perf.txt");
    // With concurrent compilation, how much the JIT's threads get done during a short and a long run is a matter of chance.
    const env = { ...bunEnv, AOT_PERF_TURNS: String(n), BUN_JSC_useConcurrentJIT: "0" };
    const run = await spawned([perf!, "stat", "-x,", "-e", "instructions:u", "-o", report, "--", ...cmd], env);
    expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const line = readFileSync(report, "utf8").split("\n").find(line => line.includes("instructions"));
    const count = Number(line!.split(",")[0]);
    expect(count).toBeFinite();
    return { count, printed: run.stdout };
  }
  async function aTurn(cmd: string[], n: number) {
    const short = await instructions(cmd, n >> 2);
    const long = await instructions(cmd, n);
    return { instructions: (long.count - short.count) / (n - (n >> 2)), printed: long.printed };
  }
  async function compiled(source: string) {
    const executable = join(String(folder), "idiom");
    const build = await spawned([bunExe(), "build", "--compile", "--aot", join(root, source), "--outfile", executable], bunEnv);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringContaining("error"), exitCode: 0 });
    return executable;
  }

  for (const name of idioms) {
    test(
      name,
      async () => {
        const n = turns[name];
        const typed = await aTurn([await compiled(name + ".ts")], n);
        const untyped = await aTurn([await compiled(name + ".js")], n);
        const jit = await aTurn([bunExe(), "run", join(root, name + ".js")], n);
        rmSync(join(String(folder), "idiom"), { force: true });
        // All three forms did the same work.
        expect([typed.printed, untyped.printed]).toEqual([jit.printed, jit.printed]);
        const now = (measured[name] = {
          typed: Math.round(typed.instructions * 10) / 10,
          untyped: Math.round(untyped.instructions * 10) / 10,
          jit: Math.round(jit.instructions * 10) / 10,
        });
        console.log([name.padEnd(64), now.typed, now.untyped, now.jit].join("\t"));
        if (mode === "update") return void writeFileSync(pinsPath, JSON.stringify({ ...pins, ...measured }, null, 2) + "\n");
        const pin = pins[name];
        expect(pin).toBeDefined();
        const worse = (["typed", "untyped"] as const).filter(
          form => (now[form] > pin[form] * 1.1 && now[form] > pin[form] + 20) || (now[form] > pin[form] * 1.25 && now[form] > pin[form] + 4),
        );
        expect({ worse, now, pin }).toEqual({ worse: [], now, pin });
      },
      600_000,
    );
  }
});
