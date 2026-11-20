// The idioms of ./idioms and ./everyday as executables, each built alone, the way a user builds it. ./step-idioms.ts counts what a turn of them takes.
import { readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { writeEverydayIdioms } from "./everyday-idioms";
import { writeTypedIdioms, writeUntypedIdioms } from "./untyped-idioms";

export const forms = ["typed", "untyped"] as const;
export type Form = (typeof forms)[number];
/** What stands around turn(): ./everyday-idioms.ts. */
export type Surroundings = "ordinary" | "called-once" | "in-a-very-large-program";

const extensions = { typed: ".ts", untyped: ".js" };

/**
 * Each idiom that `chosen` picks has an executable of its own in each form, built when it is first asked for.
 * With `marks` each program sends itself a signal in front of the long call and behind it, for ./count-steps.ts, without which the signal ends it. Only these programs have the marks:
 * they name a function of native code that the compiler knows nothing about, and one idiom in a thousand is compiled otherwise beside it.
 * "called-once" and "in-a-very-large-program" are the idioms of ./everyday alone, in that form (./everyday-idioms.ts): the programs of ./idioms write their own loops.
 * In the first the long call is the only one: nothing warms up. In the second the loop finds turn() at run time.
 */
export function idiomsInExecutables(
  bun: string,
  folder: string,
  chosen: (names: string[]) => string[],
  buildFlags: string[] = [],
  marks = false,
  surroundings: Surroundings = "ordinary",
) {
  const benchIsCalledOnce = surroundings === "called-once";
  const findsTurnAtRunTime = surroundings === "in-a-very-large-program";
  const sources = { typed: join(folder, "idioms"), untyped: join(folder, "untyped-idioms") };
  writeTypedIdioms(sources.typed);
  writeUntypedIdioms(sources.untyped);
  for (const form of marks ? forms : []) {
    const host = join(sources[form], "host.ts");
    const head = "export function nextTurns(_check: number): number {";
    const text = readFileSync(host, "utf8");
    if (!text.includes(head)) throw new Error(`${host} has no line \`${head}\``);
    writeFileSync(host, text.replace(head, `${head}\n  if (plan.length <= 1) process.kill(process.pid, "SIGUSR2");`));
  }
  for (const form of benchIsCalledOnce ? forms : []) {
    const host = join(sources[form], "host.ts");
    const rounds = "new Array(100).fill(Number(process.env.AOT_PERF_WARM_UP_TURNS ?? 5000))";
    const text = readFileSync(host, "utf8");
    if (!text.includes(rounds)) throw new Error(`${host} does not say \`${rounds}\``);
    writeFileSync(host, text.replace(rounds, "[]"));
  }
  const names = chosen(
    [
      ...readdirSync(join(import.meta.dir, "idioms"), { recursive: true })
        .map(String)
        .filter(path => surroundings === "ordinary" && path.endsWith(".ts") && path !== "host.ts")
        .map(path => path.slice(0, -3).replaceAll("\\", "/")),
      ...writeEverydayIdioms(sources.typed, sources.untyped, findsTurnAtRunTime, benchIsCalledOnce),
    ].sort(),
  );
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
  const environmentOfBuilds: Record<string, string> = buildFlags.some(flag => flag.startsWith("--aot-testing=")) ? { BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" } : {};

  async function run(cwd: string, cmd: string[], extra: Record<string, string> = {}) {
    await using child = Bun.spawn({
      cmd,
      cwd,
      env: { ...environment, ...extra },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 900_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
    if (exitCode !== 0)
      throw new Error(
        `exit code ${exitCode}${child.signalCode ? ", " + child.signalCode : ""}: ${(stderr + stdout).trim().split("\n").slice(0, 3).join(" / ").slice(0, 300)}`,
      );
    return { stdout, stderr };
  }

  const pathOf = (form: Form, name: string) => join(folder, `${form}-${name.replaceAll("/", "-")}`);
  const built = new Map<string, Promise<string>>();
  function executableOf(form: Form, name: string) {
    const executable = pathOf(form, name);
    if (!built.has(executable))
      built.set(
        executable,
        run(
          sources[form],
          [bun, "build", "--compile", "--aot", ...buildFlags, join(sources[form], name + extensions[form]), "--outfile", executable],
          environmentOfBuilds,
        ).then(() => executable),
      );
    return built.get(executable)!;
  }

  /** An executable is the size of Bun, and there are thousands of idioms: whoever has read the numbers of one removes it. */
  function remove(form: Form, name: string) {
    built.delete(pathOf(form, name));
    rmSync(pathOf(form, name), { force: true });
  }

  return {
    names,
    run,
    executableOf,
    remove,
    start: (_form: Form, _name: string, turns: number) => ({ AOT_PERF_WARM_UP_TURNS: "10", AOT_PERF_TURNS: String(turns) }),
  };
}
