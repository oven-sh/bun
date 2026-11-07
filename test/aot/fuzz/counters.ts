// What a batch of programs makes the compiler do.
//
//   bun test/aot/fuzz/counters.ts [--want=CallsInlined,LoopsWalkedAgain] [--flags="--aot-allow-code-from-disk"] [--jobs=8] [--all] <programs or folders ..>
//
// The compiler counts what it touches and some of what it does: calls inlined, loops walked again, tests that rejoin, values spilled
// (aot/ir/schema/statistics.def in the engine; --explain=statistics prints every counter). That count, not a neighbor's red control, says whether a batch asked for it.
//
// Each program is built alone, and what it raises ABOVE AN EMPTY PROGRAM under the same flags is listed: the counter, in how many programs, the sum, an example.
//
// A COUNTER IS A BUILD's, NOT A FUNCTION's. A build that holds lines of Bun's own library (SourceLinesOfBun; a `for of`, a `try`, an `await` brings some) raises nearly every
// counter in the library's code. A program that is free of it is held against an empty program: what it raises is its own. One that holds lines of it is held against the least
// value among the programs of the batch that hold as many, three at least: likely its own, since what a program reaches IN the library differs a little.
// ABOVE 0 IS NECESSARY, NOT SUFFICIENT: it says that the thing was done, not that the case of it that is wrong was met.
//
//   --want   exit code 1 unless some program raises each of these, in one of those two ways
//   --all    lists also the counters that no program of the batch raised
import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const option = (name: string) => process.argv.find(word => word.startsWith(`--${name}=`))?.slice(name.length + 3);
const want = option("want")?.split(",").filter(Boolean) ?? [];
const flags = option("flags")?.split(/\s+/).filter(Boolean) ?? [];
const jobs = Number(option("jobs")) || availableParallelism();
const isProgram = (path: string) => /\.[cm]?[jt]sx?$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
const programs = process.argv
  .slice(2)
  .filter(word => !word.startsWith("--"))
  .flatMap(path =>
    statSync(path).isDirectory()
      ? readdirSync(path, { recursive: true })
          .map(name => join(path, String(name)))
          .filter(isProgram)
      : [path],
  )
  .map(path => resolve(path));
if (!programs.length) {
  console.error(
    "usage: bun test/aot/fuzz/counters.ts [--want=A,B] [--flags=..] [--jobs=n] [--all] <programs or folders ..>",
  );
  process.exit(2);
}

const folder = mkdtempSync(join(tmpdir(), "aot-counters-"));
process.on("exit", () => rmSync(folder, { recursive: true, force: true }));
let builds = 0;
async function countersOf(program: string): Promise<Record<string, number> | undefined> {
  const executable = join(folder, `${++builds}.exe`);
  const build = ["build", "--compile", "--aot", "--explain=statistics", ...flags];
  await using child = Bun.spawn({
    cmd: [process.execPath, ...build, "./" + basename(program), "--outfile", executable],
    cwd: dirname(program),
    stdio: ["ignore", "ignore", "pipe"],
  });
  const [printed, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);
  rmSync(executable, { force: true });
  if (exitCode !== 0) return undefined;
  const lines = Array.from(printed.matchAll(/^([A-Z][A-Za-z0-9]*) (\d+)\r?$/gm));
  if (!lines.length) throw new Error(`the build of ${program} printed no counter`);
  return Object.fromEntries(lines.map(([, name, value]) => [name, Number(value)]));
}

writeFileSync(join(folder, "empty.js"), "");
const empty = await countersOf(join(folder, "empty.js"));
if (!empty) throw new Error("an empty program does not build under these flags");

type Raised = { programs: number; sum: number; example: string };
const built: { program: string; counters: Record<string, number> }[] = [];
const notBuilt: string[] = [];
const waiting = [...programs];
await Promise.all(
  Array.from({ length: Math.min(jobs, waiting.length) }, async () => {
    for (let program = waiting.pop(); program; program = waiting.pop()) {
      const counters = await countersOf(program);
      if (counters) built.push({ program, counters });
      else notBuilt.push(program);
    }
  }),
);

// What the library's own code raises is much the same for the builds that hold as many lines of it, so the least value among three or more of those stands for the library's share.
const groups = Map.groupBy(built, ({ counters }) => counters.SourceLinesOfBun);
const isCounted = (name: string) => !name.endsWith("Nanoseconds") && !name.startsWith("Source");
const names = Object.keys(empty).filter(isCounted);
const sure = new Map<string, Raised>();
const likely = new Map<string, Raised>();
const unjudged = new Set<string>();
const counted = { free: 0, judged: 0, unjudged: 0 };
for (const [lines, group] of groups) {
  const isFree = lines === 0;
  const isJudged = isFree || group.length >= 3;
  counted[isFree ? "free" : isJudged ? "judged" : "unjudged"] += group.length;
  for (const name of names) {
    const base = isFree ? (empty[name] ?? 0) : Math.min(...group.map(({ counters }) => counters[name] ?? 0));
    for (const { program, counters } of group) {
      if (!isJudged) {
        if ((counters[name] ?? 0) > (empty[name] ?? 0)) unjudged.add(name);
        continue;
      }
      const excess = (counters[name] ?? 0) - base;
      if (excess <= 0) continue;
      const raised = (isFree ? sure : likely).getOrInsertComputed(name, () => ({
        programs: 0,
        sum: 0,
        example: program,
      }));
      raised.programs++;
      raised.sum += excess;
    }
  }
}

console.log(
  `${programs.length} programs: ${counted.free} free of Bun's library, ${counted.judged} hold lines of it and are held against the least of their like, ${counted.unjudged} hold lines of it and have too few like them, ${notBuilt.length} did not build`,
);
for (const program of notBuilt.slice(0, 10)) console.log(`  did not build: ${program}`);
const say = (name: string, how: string, { programs, sum, example }: Raised) =>
  console.log(`${name} ${sum} in ${programs} programs ${how}, such as ${basename(example)}`);
for (const name of names) {
  if (sure.has(name)) say(name, "free of the library", sure.get(name)!);
  if (likely.has(name)) say(name, "above the least of their like", likely.get(name)!);
}
const onlyUnjudged = names.filter(name => unjudged.has(name) && !sure.has(name) && !likely.has(name));
if (onlyUnjudged.length)
  console.log(
    `\nONLY IN BUILDS WHOSE SHARE OF THE LIBRARY NOTHING MEASURES (${onlyUnjudged.length}): ${onlyUnjudged.join(" ")}`,
  );
if (process.argv.includes("--all")) {
  const never = names.filter(name => !sure.has(name) && !likely.has(name) && !unjudged.has(name));
  console.log(`\nRAISED BY NO PROGRAM OF THE BATCH (${never.length}): ${never.join(" ")}`);
}
const unknown = want.filter(name => !(name in empty));
if (unknown.length) console.log(`\nNO SUCH COUNTER: ${unknown.join(" ")}`);
const unasked = want.filter(name => !sure.has(name) && !likely.has(name));
if (unasked.length) console.log(`\nTHE BATCH NEVER ASKED: ${unasked.join(" ")}`);
process.exitCode = unasked.length ? 1 : 0;
