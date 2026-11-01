// In which functions the instructions of an idiom lie, built by one Bun and by another: for a row of ./pins.<os>-<arch>.json or ./everyday-pins*.<os>-<arch>.json that moved.
// Prints the functions that differ by 3 instructions a turn and by 3% of the turn, the largest difference first: on a machine with three times as many jobs as processors the share
// of a function moved by up to 2.6% of the turn between two builds that took the same sum. Where all of it lies in functions of Bun, the engine or the C library and the
// compiled code reads the same, no change of the compiler did it: a change under src/ can make the linker and the compiler lay native code out anew.
// The names come from the executables, so the Buns that build them must have their symbols: bun-profile.
//
//   bun test/aot/perf/symbols.ts <idiom> <a Bun> <another Bun> [untyped] [in-a-very-large-program]      needs perf(1) and a counter of the processor: ./README.md
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { flagsOfVeryLargeProgram, writeEverydayIdioms } from "./everyday-idioms";
import { writeTypedIdioms, writeUntypedIdioms } from "./untyped-idioms";

const [name, ...rest] = process.argv.slice(2);
const words = ["untyped", "in-a-very-large-program"];
const builders = rest.filter(word => !words.includes(word));
if (!name || builders.length !== 2) {
  console.error("usage: bun test/aot/perf/symbols.ts <idiom> <a Bun> <another Bun> [untyped] [in-a-very-large-program]");
  process.exit(2);
}
const form = rest.includes("untyped") ? "untyped" : "typed";
const inVeryLargeProgram = rest.includes("in-a-very-large-program");

const folder = mkdtempSync(join(tmpdir(), "aot-symbols-"));
const sources = { typed: join(folder, "idioms"), untyped: join(folder, "untyped-idioms") };
writeTypedIdioms(sources.typed);
writeUntypedIdioms(sources.untyped);
writeEverydayIdioms(sources.typed, sources.untyped, inVeryLargeProgram);

const pinned = ["pins", `everyday-pins${inVeryLargeProgram ? "-in-a-very-large-program" : ""}`]
  .map(file => join(import.meta.dir, `${file}.linux-x64.json`))
  .filter(existsSync)
  .map(path => JSON.parse(readFileSync(path, "utf8"))[name]?.[form])
  .find(Boolean);
const instructionsOfRun = 4e9;
const turns = Math.round(Math.min(4e6, Math.max(200, instructionsOfRun / (pinned ?? 1000))));
const instructionsOfSample = 100_003;

function run(cmd: string[], env: Record<string, string> = {}) {
  const { exitCode, stdout, stderr } = Bun.spawnSync({
    cmd,
    cwd: sources[form],
    env: { PATH: process.env.PATH, HOME: folder, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (exitCode !== 0) throw new Error(`${cmd.slice(0, 3).join(" ")}: exit code ${exitCode}: ${stderr.toString().slice(0, 600)}`);
  return stdout.toString() + stderr.toString();
}

function bySymbol(bun: string, index: number) {
  const executable = join(folder, `built-by-${index}`);
  const entryPoint = join(sources[form], name + (form === "typed" ? ".ts" : ".js"));
  run([bun, "build", "--compile", "--aot", ...(inVeryLargeProgram ? flagsOfVeryLargeProgram : []), entryPoint, "--outfile", executable]);
  const data = `${executable}.data`;
  run(["perf", "record", "-q", "-e", "instructions:u", "-c", String(instructionsOfSample), "-o", data, executable], {
    AOT_PERF_TURNS: String(turns),
  });
  // A busy machine loses samples, of every function alike: the sum is counted, and the samples only share it out.
  const counted = Number(
    /^(\d+),/m.exec(run(["perf", "stat", "-x", ",", "-e", "instructions:u", executable], { AOT_PERF_TURNS: String(turns) }))?.[1],
  );
  const samplesOf = new Map<string, number>();
  for (const [, samples, symbol] of run(["perf", "report", "-i", data, "--no-children", "--sort", "symbol", "-F", "sample,symbol", "--stdio"]).matchAll(
    /^ +(\d+) +\[.\] (.*)$/gm,
  )) {
    const named = symbol.replace(/( +-)+ *$/, "").trim();
    // perf gives an address that no function holds to the last name in front of it, with the distance.
    const key = /^0x[0-9a-f]+$|\+0x[0-9a-f]+$/.test(named) ? "(no name: the code that the compiler made)" : named.slice(0, 110);
    samplesOf.set(key, (samplesOf.get(key) ?? 0) + Number(samples));
  }
  const samples = [...samplesOf.values()].reduce((sum, count) => sum + count, 0);
  return new Map([...samplesOf].map(([key, count]) => [key, ((count / samples) * counted) / turns]));
}

try {
  const [one, other] = builders.map(bySymbol);
  const sum = (aTurn: Map<string, number>) => [...aTurn.values()].reduce((sum, count) => sum + count, 0);
  console.log(`${name}, ${form}, ${turns} turns: ${sum(one).toFixed(1)} > ${sum(other).toFixed(1)} instructions a turn`);
  const rows = [...new Set([...one.keys(), ...other.keys()])]
    .map(symbol => ({ symbol, one: one.get(symbol) ?? 0, other: other.get(symbol) ?? 0 }))
    .filter(row => Math.abs(row.other - row.one) >= Math.max(3, sum(one) * 0.03))
    .sort((a, b) => Math.abs(b.other - b.one) - Math.abs(a.other - a.one));
  for (const row of rows.slice(0, 24))
    console.log(`${row.one.toFixed(1).padStart(10)} > ${row.other.toFixed(1).padStart(10)}  ${row.symbol}`);
  if (rows.length === 0) console.log("no function differs by 3 instructions a turn and 3%");
} finally {
  rmSync(folder, { recursive: true, force: true });
}
