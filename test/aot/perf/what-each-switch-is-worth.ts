// What each optional part of the compiler is worth on every idiom of ./idioms and ./everyday: each idiom is compiled as TypeScript and as JavaScript, then once more with
// each switch off alone (--aot-disable). A pass that changed nothing in the first build is not switched off, and an executable that differs from the first by nothing but
// the byte that records the switch is not run.
//
//   bun test/aot/perf/what-each-switch-is-worth.ts --out rows.tsv [--bun <path>] [--switches InlineCalls,flow:CalleeSets,rule:PropertyRun,b3:RotateLoops]
//       [--only <regular expression>] [--part 1/3] [--jobs 16] [--testaot <path>]
//
// --testaot names the engine's test program of the same sources: it compiles the program that the front end wrote in a sixth of the time of a whole build, so it is asked
// first whether a switch changes anything. Several switches joined by + are switched off together; bun:<path> in the place of a switch is another Bun, whose executable
// is always run. Without --switches: every optional pass and every result of the flow analysis. A row of rows.tsv is an executable that differs:
// idiom, ts | js, switch, instructions a turn with everything on, with the switch off, most MB resident with everything on, with the switch off, bytes that the
// executable grows by, what failed. It prints a line a switch: executables that differ, idioms that take over 5% more without it, over 5% fewer, the three that lose most.
//
// ./idioms-against-the-jit.ts says how a turn is counted.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import { parseArgs } from "util";
import { measureCommand } from "../analysis-scaling/measure-check";
import { idiomsAgainstTheJit } from "./measure-idioms";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    switches: { type: "string" },
    only: { type: "string", default: "" },
    part: { type: "string", default: "1/1" },
    jobs: { type: "string", default: "16" },
    testaot: { type: "string" },
    out: { type: "string", default: "rows.tsv" },
  },
});
const bun = resolve(options.bun);
const folder = mkdtempSync(join(tmpdir(), "what-each-switch-is-worth-"));
const sources = { ts: join(folder, "idioms"), js: join(folder, "untyped-idioms") };
const [part, parts] = options.part.split("/").map(Number);
const names = idiomsAgainstTheJit(bun, folder)
  .names.filter(name => new RegExp(options.only).test(name))
  .filter((_, index) => index % parts === part - 1);
const pinnedTurns: Record<string, number> = JSON.parse(readFileSync(join(import.meta.dir, "turns.json"), "utf8"));
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
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};

function registeredSwitches(): string[] {
  const { stdout } = Bun.spawnSync({ cmd: [bun, "build", "--compile", "--aot", "--aot-list", "registry", join(sources.js, names[0] + ".js")], env: environment, cwd: folder });
  const registry = JSON.parse(stdout.toString());
  return [...registry.passes.filter((pass: { isOptional: boolean }) => pass.isOptional).map((pass: { name: string }) => "pass:" + pass.name), ...registry.flowResults.map((name: string) => "flow:" + name)];
}
const switches = options.switches?.split(",") ?? registeredSwitches();

// Everything in front of this is the runtime, the same in every executable but for its build id.
const startOfProgram = statSync(bun).size - (1 << 20);

async function build(source: string, executable: string, flags: string[], compiler = bun) {
  rmSync(executable, { force: true });
  await using child = Bun.spawn({ cmd: [compiler, "build", "--compile", "--aot", "--aot-threads=1", ...flags, source, "--outfile", executable], cwd: dirname(source), env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 300_000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  if (exitCode !== 0) throw new Error(`the build: exit code ${exitCode}${child.signalCode ? ", " + child.signalCode : ""}: ${(stderr + stdout).trim().split("\n").slice(0, 2).join(" / ").slice(0, 200)}`);
  return new Uint8Array(await Bun.file(executable).slice(startOfProgram).arrayBuffer());
}

async function compile(program: string, image: string, words: string[]) {
  await using child = Bun.spawn({ cmd: [resolve(options.testaot!), "compile", program, "--output=" + image, "threads=1", ...words], env: environment, stdin: "ignore", stdout: "ignore", stderr: "ignore", timeout: 300_000, killSignal: "SIGKILL" });
  return (await child.exited) === 0 ? new Uint8Array(await Bun.file(image).arrayBuffer()) : undefined;
}

// The switches that are off are recorded in a few words that lie together.
function differsBySwitchesAlone(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let first = 0;
  while (first < a.length && Buffer.compare(a.subarray(first, first + 4096), b.subarray(first, first + 4096)) === 0) first += 4096;
  while (first < a.length && a[first] === b[first]) first++;
  return first >= a.length || Buffer.compare(a.subarray(first + 64), b.subarray(first + 64)) === 0;
}

async function cost(executable: string, turns: number, warmUp: number) {
  const run = (turns: number) => measureCommand(folder, ["/usr/bin/time", "-f", "peak %M", executable], 900_000, { ...environment, AOT_PERF_TURNS: String(turns), AOT_PERF_WARM_UP_TURNS: String(warmUp) });
  const short = await run(turns >> 2);
  const long = await run(turns);
  return { instructions: Math.max(0.5, (long.instructions! - short.instructions!) / (turns - (turns >> 2))), peakMegabytes: Number(/^peak (\d+)$/m.exec(long.stderr)?.[1]) / 1024, printed: long.stdout };
}

const rows: string[][] = [];
const waiting = names.flatMap(name => (["ts", "js"] as const).map(form => ({ name, form })));
let done = 0;
await Promise.all(
  Array.from({ length: Number(options.jobs) }, async (_, job) => {
    mkdirSync(join(folder, String(job)));
    const executable = join(folder, String(job), "program");
    for (let next = waiting.shift(); next; next = waiting.shift()) {
      const { name, form } = next;
      const source = join(sources[form], `${name}.${form}`);
      try {
        const report = join(folder, String(job), "report.json");
        const program = join(folder, String(job), "program.bin");
        const image = join(folder, String(job), "image");
        const whole = await build(source, executable, ["--aot-report=" + report, "--aot-out=" + program]);
        const wholeImage = options.testaot ? await compile(program, image, []) : undefined;
        const idle = new Set<string>(JSON.parse(readFileSync(report, "utf8")).passes.flatMap((pass: { name: string; changes: number }) => (pass.changes ? [] : ["pass:" + pass.name])));
        const few = await cost(executable, 4000, 20);
        const clamp = (value: number, least: number, most: number) => Math.round(Math.min(most, Math.max(least, value)));
        const turns = pinnedTurns[name] ?? clamp(300e6 / few.instructions, 8000, 20e6);
        const warmUp = clamp(1e6 / few.instructions, 20, 5000);
        const before = await cost(executable, turns, warmUp);
        for (const off of switches) {
          if (idle.has(off)) continue;
          try {
            const other = off.startsWith("bun:") ? resolve(off.slice(4)) : undefined;
            const names = off.replaceAll("+", ",");
            const imageWithout = wholeImage && !other && (await compile(program, image, ["disable=" + names]));
            if (imageWithout && differsBySwitchesAlone(wholeImage, imageWithout)) continue;
            const without = await build(source, executable, other ? [] : ["--aot-disable=" + names], other);
            if (!other && differsBySwitchesAlone(whole, without)) continue;
            const after = await cost(executable, turns, warmUp);
            rows.push([name, form, off, before.instructions.toFixed(1), after.instructions.toFixed(1), before.peakMegabytes.toFixed(1), after.peakMegabytes.toFixed(1), String(without.length - whole.length), after.printed === before.printed ? "" : "prints something else"]);
          } catch (error) {
            rows.push([name, form, off, before.instructions.toFixed(1), "", "", "", "", String((error as Error).message).split("\n")[0].slice(0, 300)]);
          }
        }
      } catch (error) {
        rows.push([name, form, "", "", "", "", "", "", String((error as Error).message).split("\n")[0].slice(0, 300)]);
      }
      if (++done % 50 === 0) {
        console.error(`${done} of ${names.length * 2}`);
        writeFileSync(options.out, rows.map(row => row.join("\t")).join("\n") + "\n");
      }
    }
  }),
);
rmSync(folder, { recursive: true, force: true });
writeFileSync(options.out, rows.map(row => row.join("\t")).sort().join("\n") + "\n");

console.log(`${names.length} idioms, twice each. switch: executables that differ | over 5% more instructions without it | over 5% fewer | fail | the three that lose most`);
for (const off of switches) {
  const mine = rows.filter(row => row[2] === off);
  const measured = mine.filter(row => row[4]).map(row => ({ name: `${row[0]}.${row[1]}`, ratio: Number(row[4]) / Number(row[3]), more: Number(row[4]) - Number(row[3]) }));
  const moved = (row: { ratio: number; more: number }) => Math.abs(row.more) >= 1;
  const worse = measured.filter(row => row.ratio > 1.05 && moved(row)).sort((a, b) => b.ratio - a.ratio);
  console.log(
    `${off}: ${mine.length} | ${worse.length} | ${measured.filter(row => row.ratio < 0.95 && moved(row)).length} | ${mine.filter(row => row[8]).length} | ` +
      worse.slice(0, 3).map(row => `${row.name} x ${row.ratio.toFixed(2)}`).join(", "),
  );
}
