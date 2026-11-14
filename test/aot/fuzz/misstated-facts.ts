// Asks which facts of the whole-program analysis the programs would miss if they were wrong.
//
//   bun test/aot/fuzz/misstated-facts.ts                                      every fact, over the programs of ../parallel
//   bun test/aot/fuzz/misstated-facts.ts --facts FieldType,FieldFilled --most 200
//   bun test/aot/fuzz/misstated-facts.ts --sources facts-ended-by-one-statement --most 500
//   bun test/aot/fuzz/misstated-facts.ts --test-cases yes                     each fact over the one stored program that is known to see it
//
// `--aot-testing=MisstateFact:<fact>` claims one fact (a field always holds numbers, a class has no objects, a name is never
// written ..) at every place of a program where it does not hold, and `MisstateFact:<fact>:<seed>` at one drawn place. Only a local build of the
// engine knows the word (aot/facts/AOTFactFaults.h). `MisstateFact:Count` prints the number of places of each fact.
//
// For each fact the programs are taken in a drawn order. If the executable keeps its bytes with the fact misstated at every place, the fact has no
// consequence in that program. Otherwise one drawn place is misstated at a time. A program sees the fault if its executable prints something else
// than `bun <file>` (or than the output in its last comment), ends otherwise or crashes. The output has a line for each fact:
//
//   seen      a program sees it: how many programs it took, and which one
//   stopped   no program sees it, and the build or a check in the executable stops
//   unseen    the bytes of executables change, and every program prints the same
//   same      the bytes of no executable change
//
// misstated-facts.test-cases.tsv names a stored program for each fact that some stored program sees. With --test-cases every place of the fact in
// that program is misstated in turn until the program sees one. A program that no longer does is listed as `lost`, and the exit code is 1: either
// the compiler no longer uses the fact there, and another program is needed, or a check that used to fail holds no more.
//
// Options
//   --test-cases yes     see above
//   --facts a,b          only these facts (default: all that have a place in some program)
//   --most <n>           programs for each fact (default 40)
//   --draws <n>          drawn places for each program (default 4)
//   --programs <n>       programs at all, drawn (default 1000)
//   --sources a,b        programs of these sources of ./sources.ts, in place of the stored ones
//   --programs-root <folder>   the stored programs (default ../parallel)
//   --flags "<flags>"    added to every build
//   --seed <n>           draws other programs and other places (default 1)
//   --jobs <n>           concurrent builds (default: a quarter of the cores)
//   --bun <path>         the Bun under test (default: the one that runs this script)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { dirname, join, relative } from "path";
import { Random } from "./random";
import { allSources } from "./sources";

const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) options.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
const number = (name: string, otherwise: number) => Number(options.get(name) ?? otherwise);
const list = (name: string) => options.get(name)?.split(",").filter(Boolean) ?? [];

const bun = options.get("bun") ?? process.execPath;
const root = options.get("programs-root") ?? join(import.meta.dir, "..", "parallel");
const seed = number("seed", 1);
const most = number("most", 40);
const draws = number("draws", 4);
const jobs = number("jobs", Math.max(1, availableParallelism() >> 2));
const flags = options.get("flags")?.split(" ").filter(Boolean) ?? [];
const work = mkdtempSync(join(tmpdir(), "misstated-facts-"));

interface Run {
  code: number | null;
  out: string;
  error: string;
}
interface Subject {
  path: string;
  plain: Run;
  bytes: string;
  places: Map<string, number>;
}

const environment = { ...process.env, NO_COLOR: "1", BUN_ENABLE_CRASH_REPORTING: "0", TZ: "UTC" };
const buildEnvironment = {
  ...environment,
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  BUN_AOT_WRITES_PROGRAM_ALONE: "1",
};

async function run(cmd: string[], cwd: string, seconds: number, env = environment): Promise<Run> {
  await using child = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
  });
  const [out, error] = await Promise.all([child.stdout.text(), child.stderr.text()]);
  await child.exited;
  return { code: child.signalCode ? null : child.exitCode, out, error };
}

async function build(path: string, executable: string, testing: string[]) {
  rmSync(executable, { force: true });
  const words = ["TypeErrorsWarn", ...testing].map(word => `--aot-testing=${word}`);
  const built = await run(
    [bun, "build", "--compile", "--aot", ...words, ...flags, path, "--outfile", executable],
    dirname(path),
    120,
    buildEnvironment,
  );
  const file = Bun.file(executable);
  return { ...built, bytes: (await file.exists()) ? Bun.hash(await file.bytes()).toString(16) : undefined };
}

const isSame = (a: Run, b: Run) => a.code === b.code && a.out === b.out;

async function examine(path: string, slot: string): Promise<Subject | undefined> {
  const runPlain = () => run([bun, "--no-install", "run", path], dirname(path), 15);
  let plain = await runPlain();
  if (plain.code === null) return;
  const count = await build(path, slot, ["MisstateFact:Count"]);
  if (!count.bytes) return;
  const { bytes } = await build(path, slot, []);
  if (!bytes) return;
  const executable = await run([slot], dirname(path), 20);
  if (isSame(plain, executable)) {
    if (!isSame(plain, await runPlain())) return;
  } else {
    // A program that differs from plain Bun on purpose ends in a comment with its output.
    const [, written] = readFileSync(path, "utf8").match(/^\/\* Output:\n(.*)\*\/\s*$/ms) ?? [];
    if (executable.code !== 0 || executable.out !== written) return;
    plain = executable;
  }
  const places = new Map(
    [...count.error.matchAll(/^misstated fact (\w+): (\d+)$/gm)].map(([, fact, places]) => [fact, Number(places)]),
  );
  return { path, plain, bytes, places };
}

function storedPrograms(): string[] {
  const isAlone = (path: string) =>
    !/^\s*\/\/ *(Flags|Entry points|Runs by itself|Env|Build prints|Reference|Todo|Under|Exit code)\b/m.test(
      readFileSync(path, "utf8").slice(0, 4000),
    );
  const folders = new Map<string, string>();
  const files: string[] = [];
  for (const path of new Bun.Glob("**/*.{ts,js,mjs,cjs,mts,cts}").scanSync(root)) {
    if (/(^|\/)main\.\w+$/.test(path)) folders.set(dirname(path), path);
    else files.push(path);
  }
  const isInProgram = (path: string) => {
    for (let folder = dirname(path); folder !== "."; folder = dirname(folder)) if (folders.has(folder)) return true;
    return false;
  };
  return [...folders.values(), ...files.filter(path => !path.endsWith(".test.ts") && !isInProgram(path))]
    .map(path => join(root, path))
    .filter(isAlone)
    .sort();
}

async function generatedPrograms(names: string[], count: number): Promise<string[]> {
  const sources = await allSources(root, new Set(), true);
  const runner = { name: "product", accepts: () => true, allows: () => true } as any;
  const paths: string[] = [];
  for (let i = 0; paths.length < count && i < 3 * count; i++) {
    const name = names[i % names.length];
    const program = sources[name]?.(seed * 1_000_003 + i, runner);
    if (!program) continue;
    const folder = join(work, "programs", `${name}-${i}`);
    for (const [path, text] of Object.entries({
      [`main.${program.extension}`]: program.text,
      ...(program as any).files,
    })) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), text as string);
    }
    paths.push(join(folder, `main.${program.extension}`));
  }
  return paths;
}

async function inSlots<T>(items: T[], body: (item: T, slot: string) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: jobs }, async (_, slot) => {
      mkdirSync(join(work, `slot-${slot}`), { recursive: true });
      while (next < items.length) await body(items[next++], join(work, `slot-${slot}`, "program"));
    }),
  );
}

if (options.has("test-cases")) {
  const lines = readFileSync(join(import.meta.dir, "misstated-facts.test-cases.tsv"), "utf8")
    .trim()
    .split("\n");
  const only = new Set(list("facts"));
  const testCases = lines.map(line => line.split("\t")).filter(([fact]) => !only.size || only.has(fact));
  let lost = 0;
  await inSlots(testCases, async ([fact, name], slot) => {
    const subject = await examine(join(root, name), slot);
    const places = subject?.places.get(fact) ?? 0;
    for (let place = 0; place < Math.min(places, 60); place++) {
      const { path, plain, bytes } = subject!;
      const one = await build(path, slot, [`MisstateFact:${fact}:${2 ** 31 + place}`]);
      if (!one.bytes || one.bytes === bytes) continue;
      if (isSame(plain, await run([slot], dirname(path), 20)) || isSame(plain, await run([slot], dirname(path), 60)))
        continue;
      console.log(`seen     ${fact}: place ${place} of ${places}, by ${name}`);
      return;
    }
    lost++;
    console.log(
      `lost     ${fact}: ${subject ? `none of ${places} places is seen` : "it does not print what it should"}, by ${name}`,
    );
  });
  console.log(`${testCases.length - lost} of ${testCases.length} facts are seen by their programs`);
  rmSync(work, { recursive: true, force: true });
  process.exit(lost ? 1 : 0);
}

const random = new Random(seed);
const programs = number("programs", 1000);
const names = list("sources");
const paths = names.length
  ? await generatedPrograms(names, programs)
  : random.shuffled(storedPrograms()).slice(0, programs);
const subjects: Subject[] = [];
await inSlots(paths, async (path, slot) => {
  const subject = await examine(path, slot);
  if (subject) subjects.push(subject);
});
console.error(`${subjects.length} of ${paths.length} programs print as plain Bun does, twice`);

const facts = list("facts").length
  ? list("facts")
  : [...new Set(subjects.flatMap(({ places }) => [...places.keys()]))].sort();
let seenFacts = 0;
await inSlots(facts, async (fact, slot) => {
  const order = new Random(Bun.hash.crc32(fact) ^ seed)
    .shuffled(subjects.filter(({ places }) => places.has(fact)))
    .slice(0, most);
  let changed = 0;
  let stopped = "";
  for (const [index, { path, plain, bytes, places }] of order.entries()) {
    const name = relative(names.length ? join(work, "programs") : root, path);
    const all = await build(path, slot, [`MisstateFact:${fact}`]);
    if (all.bytes === bytes) continue;
    changed++;
    for (let draw = 0; draw < Math.min(draws, 2 * places.get(fact)!); draw++) {
      const one = await build(path, slot, [
        `MisstateFact:${fact}:${1 + ((index * 7919 + draw * 15485863 + seed * 104729) % 2000003)}`,
      ]);
      if (one.bytes === bytes) continue;
      if (!one.bytes) {
        stopped ||= name;
        continue;
      }
      if (isSame(plain, await run([slot], dirname(path), 20)) || isSame(plain, await run([slot], dirname(path), 60)))
        continue;
      seenFacts++;
      console.log(`seen     ${fact}: after ${index + 1} programs, by ${name}`);
      return;
    }
  }
  console.log(
    stopped
      ? `stopped  ${fact}: the build of ${stopped}`
      : `${changed ? "unseen  " : "same    "} ${fact}: ${order.length} programs, ${changed} with other bytes`,
  );
});
console.log(`${seenFacts} of ${facts.length} facts are seen by some program`);
rmSync(work, { recursive: true, force: true });
