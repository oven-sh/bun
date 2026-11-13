// Holds the clock beside the answer: each program of a folder is built alone and run, and `bun <file>` runs the same file beside it.
//
//   bun run-price-sweep.ts --bun <the Bun that builds and runs> --programs <folder written by write-price-sweep.ts> [--jobs 8]
//
// Prints one line a program, fields parted by tabs: its name, `same` | `parts` | `stops`, how many type guards can fail, the seconds of `bun <file>`, the seconds of the executable, and their ratio. Seconds are
// processor time of the whole process, so that a busy machine does not read as a slow program. Where the executable takes twice as long and 0.3 s more, both run a second time and the lesser reading stands, and
// two more fields follow: the seconds of the program built without guesses, and built with every body in its slow version. Where the first is small and the second is what the program takes as built, a guess failed.
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import "../../harness/without-installing-packages";

const { values: options } = parseArgs({
  options: { bun: { type: "string" }, programs: { type: "string" }, jobs: { type: "string", default: "8" } },
});
if (!options.bun || !options.programs) throw new Error("--bun and --programs are required");
const [bun, programs] = [resolve(options.bun), resolve(options.programs)];

async function run(cmd: string[], cwd: string, limit: number) {
  const child = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: limit * 1000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code, seconds: Number(child.resourceUsage()?.cpuTime.total ?? 0) / 1e6 };
}

async function price(name: string) {
  const folder = mkdtempSync(join(tmpdir(), "price-"));
  try {
    copyFileSync(join(programs, name), join(folder, "program.ts"));
    const build = (out: string, word: string) =>
      run([bun, "build", "--compile", "--aot", word, "program.ts", "--outfile", join(folder, out)], folder, 300);
    const built = await build("as-built", "--explain=guards");
    if (built.code !== 0) return [name, "stops"];
    const guards = /^note: (\d+) type guards? can fail/m.exec(built.stdout + built.stderr)?.[1] ?? "0";
    const both = async () => [
      await run([bun, "program.ts"], folder, 90),
      await run([join(folder, "as-built")], folder, 90),
    ];
    const [plain, ours] = await both();
    let [before, after] = [plain.seconds, ours.seconds];
    const arms: string[] = [];
    if (after >= 2 * before && after - before > 0.3) {
      const [plainAgain, oursAgain] = await both();
      [before, after] = [Math.min(before, plainAgain.seconds), Math.min(after, oursAgain.seconds)];
      for (const word of ["IgnoreExpectedTypes", "ForceStraightCompilation"])
        arms.push(
          (await build(word, `--aot-testing=${word}`)).code === 0
            ? (await run([join(folder, word)], folder, 90)).seconds.toFixed(2)
            : "stops",
        );
    }
    const answer = plain.stdout === ours.stdout && plain.code === ours.code ? "same" : "parts";
    return [
      name,
      answer,
      guards,
      before.toFixed(2),
      after.toFixed(2),
      (after / Math.max(before, 0.01)).toFixed(1),
      ...arms,
    ];
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const names = readdirSync(programs)
  .filter(name => name.endsWith(".ts"))
  .sort();
let next = 0;
await Promise.all(
  Array.from({ length: Number(options.jobs) }, async () => {
    while (next < names.length) console.log((await price(names[next++])).join("\t"));
  }),
);
