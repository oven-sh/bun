// Hundreds of the programs under ./programs in ONE executable: a build costs about as much for 250 small programs as for one, so a way of generating code that every
// function can take is tried on thousands of programs for the price of a few dozen. joined() builds each group twice, once with every function through B3 and once with
// the flags under test, runs both and compares what each program printed. Nothing is stored: the first build is the measure of the second.
//
// A group is a module that imports its programs one after the other, prints a line in front of each and catches what it throws. After a crash the executable is started
// again behind the program that crashed, so one fault does not hide the programs behind it.
//
// Left out: a program of several files; one with a file beside it (it needs flags, or differs from plain Bun on purpose); and whatever cannot share a process with others
// or says something else each time: its own path or arguments, stack texts, the clock, random numbers, timers, files, sockets, processes, an exit, a change to a built-in.
import { afterAll, describe, expect, test } from "bun:test";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { dirname, join } from "path";
import { limitsLowered } from "./harness/limits";
import { inPrograms, inShare, isGroup, keptBeside, listWrittenPrograms, partInShare, slot, taken, unsupported, withoutCoreDump, withoutDebugInformation } from "./run-programs";

const root = join(import.meta.dir, "programs");
// Of which about 250 can be joined.
const namesInGroup = 300;
// What a script makes from a few rows of the table of built-ins is listed under one name until it is made (run-programs.ts).
const programsUnderOneName = 6;
const groupsInShare = isASAN ? 1 : 3;
// A validating build of many joined programs, or of a large one beside others, needs gigabytes and minutes.
const programsInValidatingBuild = 40;
const bytesOfLargeProgram = 20_000;
const measure = ["--aot-heat=everything-is-hot"];

const cannotBeJoined = new RegExp(
  [
    String.raw`process\.exit|process\.argv|import\.meta|__filename|__dirname|Bun\.main|\.stack\b|captureStackTrace|prepareStackTrace|Date\.now|new Date\(\)|performance\.now|Math\.random|hrtime|nanoseconds`,
    String.raw`\.prototype\.\w+\s*=[^=]|\.prototype\[|Object\.defineProperty\(\s*\w+\.prototype|setPrototypeOf\(\s*(Array|Object|Function|String|Number|Map|Set|Promise|RegExp|Symbol|Error)\b`,
    String.raw`globalThis\.|globalThis\[|\beval\b|new Function|Function\(|new Worker|process\.on\(|uncaughtException|unhandledRejection|setTimeout|setInterval|setImmediate|Bun\.sleep|Bun\.serve|Bun\.spawn|child_process`,
    String.raw`process\.stdout|process\.stderr|process\.env|Bun\.env|console\.(error|warn|trace|table|time|count|group|dir)|require\.cache|require\.main|module\.|Symbol\.for\(|FinalizationRegistry|WeakRef|Bun\.gc|\bgc\(|edenGC|fullGC`,
    String.raw`delete\s+(Array|Object|Function|String|Number|Math|JSON|Reflect)\.|\b(Array|Object|Function|String|Number|Math|JSON|Reflect|Promise|Map|Set|Symbol)\.\w+\s*=[^=]|jsc-shell-functions|bun:jsc|bun:internal`,
    String.raw`node:fs|["']fs["']|fs/promises|Bun\.write|Bun\.file|node:net|node:https?|node:http2|["']https?["']|node:os|fetch\(|Bun\.connect|Bun\.listen|node:dgram|node:tls|node:dns|Bun\.\$|mkdtemp|tmpdir|homedir`,
    String.raw`node:worker_threads|node:cluster|bun:sqlite|bun:ffi|Bun\.openInEditor|Bun\.which|node:readline|node:repl|node:inspector|node:vm|WebSocket|Bun\.udpSocket|Bun\.dns|process\.chdir|process\.kill|process\.abort`,
    String.raw`^\s*(import|export)\b.*from\s+["']\.|require\(\s*["']\.|import\(\s*["']\.`,
  ].join("|"),
  "m",
);
const filesBeside = [".json", ".expected.txt", ".build-errors.txt", ".todo.txt"];

const isOneFile = (name: string) => /^[^/]+\/[^/]+(?<!\.d)\.(ts|tsx|js)$/.test(name);

/** By their paths alone: what a program says is read only where its group is taken, and what a script writes is written there. */
function programsOfOneFile(): string[] {
  const chosen: string[] = [];
  for (const topic of readdirSync(root, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!topic.isDirectory()) continue;
    const entries = readdirSync(join(root, topic.name), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    const present = new Set(entries.map(entry => entry.name));
    for (const entry of entries) {
      const [, stem, extension] = /^(.*)\.(ts|tsx|js)$/.exec(entry.name) ?? [];
      if (extension && entry.isFile() && !stem.endsWith(".d") && !filesBeside.some(suffix => present.has(stem + suffix))) chosen.push(join(root, topic.name, entry.name));
    }
  }
  const hasFileBeside = (path: string) => filesBeside.some(suffix => existsSync(keptBeside(path) + suffix));
  chosen.push(...listWrittenPrograms(/\.(ts|tsx|js)$/).filter(path => isGroup(path) || (isOneFile(inPrograms(path).replaceAll("\\", "/")) && !hasFileBeside(path))));
  return chosen
    .map(path => [inPrograms(path), path])
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, path]) => path);
}

/** About `namesInGroup` programs each. */
function groupsOf(paths: string[]): string[][] {
  const groups: string[][] = [[]];
  let programs = 0;
  for (const path of paths) {
    if (programs >= namesInGroup) (groups.push([]), (programs = 0));
    groups.at(-1)!.push(path);
    programs += isGroup(path) ? programsUnderOneName : 1;
  }
  return groups;
}

function textOfGroup(names: string[]): string {
  const lines = [
    `const from = Number(process.env.FROM ?? 0);`,
    `function starts(index: number, name: string): boolean {`,
    `  if (index < from) return false;`,
    `  console.log("==", index, name);`,
    `  return true;`,
    `}`,
    `async function ends(error?: unknown) {`,
    `  if (error !== undefined) console.log("threw", String(error));`,
    `  for (let turn = 0; turn < 8; turn++) await null;`,
    `}`,
  ];
  names.forEach((name, index) => {
    lines.push(`if (starts(${index}, ${JSON.stringify(name)})) {`, `  try {`);
    if (name.endsWith(".js")) lines.push(`    // @ts-ignore`);
    lines.push(`    await import(${JSON.stringify("./programs/" + name)});`, `    await ends();`, `  } catch (error) {`, `    await ends(error ?? null);`, `  }`, `}`);
  });
  return [...lines, `console.log("== end");`, `export {};`, ``].join("\n");
}

/** What each program of a group printed, by its name. */
function byProgram(output: string): Map<string, string> {
  const printed = new Map<string, string>();
  for (const section of output.split(/^(?=== )/m)) {
    const [, name] = /^== \d+ (\S+)\n/.exec(section) ?? [];
    // A duration that a program measures is not part of its behavior.
    if (name) printed.set(name, section.slice(section.indexOf("\n") + 1).replace(/ [0-9]+ms$/gm, ""));
  }
  return printed;
}

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>, seconds: number) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: seconds * 1000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

type Ran = { printed: Map<string, string>; stopped: string[] };

async function run(executable: string | string[], cwd: string, env: Record<string, string> = {}, seconds = isASAN ? 300 : 60): Promise<Ran> {
  let output = "";
  const stopped: string[] = [];
  for (let from = 0, starts = 0; starts < 12; starts++) {
    const ran = await spawned(withoutCoreDump([executable].flat()), cwd, { ...bunEnv, ...env, FROM: String(from) }, seconds);
    output += ran.stdout;
    if (/^== end$/m.test(ran.stdout)) break;
    const [, index, name] = [...ran.stdout.matchAll(/^== (\d+) (\S+)$/gm)].at(-1) ?? [];
    stopped.push(`${name ?? "before the first program"}: ${ran.signal ?? `exit code ${ran.exitCode}`}`);
    // No machine that runs one of these lanes can be asked afterwards.
    if (ran.signal) console.error(`DIED: ${name ?? "before the first program"}: ${ran.signal}\n${ran.stderr.slice(0, 4000)}`);
    from = Number(index ?? from) + 1;
  }
  return { printed: byProgram(output), stopped };
}

const joinable = (listed: string[]) =>
  taken(listed, () => true).filter(path => isOneFile(inPrograms(path).replaceAll("\\", "/")) && !filesBeside.some(suffix => existsSync(path.replace(/\.[a-z]+$/, suffix))));

/** A large program by itself, the others `programsInValidatingBuild` at a time. */
function splitForValidatingBuild(paths: string[]): string[][] {
  const isLarge = (path: string) => statSync(path).size > bytesOfLargeProgram;
  const small = paths.filter(path => !isLarge(path));
  const parts = paths.filter(isLarge).map(path => [path]);
  for (let from = 0; from < small.length; from += programsInValidatingBuild) parts.push(small.slice(from, from + programsInValidatingBuild));
  return parts;
}

/** Writes a group below `cwd` and builds it with `flags` as `name`. What the compiler refuses beside the others has left `names`. Nothing where nothing of the group can be joined. */
async function written(cwd: string, carrier: string[], group: number | string, paths: string[], name: string, flags: string[]) {
  const pathOf = new Map(paths.map(path => [inPrograms(path).replaceAll("\\", "/"), path]));
  let names = [...pathOf.keys()].filter(name => !cannotBeJoined.test(readFileSync(pathOf.get(name)!, "utf8")));
  // Nothing of the group can be joined, or the rows it was listed for came to no program.
  if (names.length === 0) return undefined;
  for (const name of names) {
    const text = readFileSync(pathOf.get(name)!, "utf8");
    mkdirSync(dirname(join(cwd, "programs", name)), { recursive: true });
    // A TypeScript file without an import or an export is a script, whose declarations would meet those of the other programs.
    writeFileSync(join(cwd, "programs", name), name.endsWith(".js") || /^\s*(import|export)\b/m.test(text) ? text : text + "\nexport {};\n");
  }
  writeFileSync(join(cwd, "tsconfig.json"), readFileSync(join(root, "tsconfig.json"), "utf8").replace(`"../../../packages"`, JSON.stringify(join(import.meta.dir, "..", "..", "packages"))));

  const build = async (name: string, flags: string[], env: Record<string, string | undefined> = bunEnv) => {
    const executable = join(cwd, name);
    return { ...(await spawned([bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, "group.ts", "--outfile", executable], cwd, env, flags.includes("--aot-validate") ? 600 : 240)), executable };
  };
  // A program that the compiler refuses beside the others, for a name that two of them declare, leaves the group.
  let first = { stdout: "", stderr: "", exitCode: 1, executable: "" };
  for (let attempt = 0; attempt < 6 && first.exitCode; attempt++) {
    writeFileSync(join(cwd, "group.ts"), textOfGroup(names));
    first = await build(name, flags);
    const refused = new Set([...first.stderr.matchAll(/[\\/]programs[\\/](\S+?\.(?:tsx|ts|js))/g)].map(match => match[1].replaceAll("\\", "/")));
    if (first.exitCode && !refused.size) break;
    if (first.exitCode) console.error(`LEFT OUT of group ${group}: ${[...refused].join(", ")}`);
    if (first.exitCode) names = names.filter(name => !refused.has(name));
  }
  expect({ build: name, stderr: first.exitCode ? first.stderr.slice(-2000) : "", exitCode: first.exitCode }).toEqual({ build: name, stderr: "", exitCode: 0 });
  return { names, build, first };
}

async function compare(folder: string, carrier: string[], group: number | string, listed: string[], flags: string[]) {
  const cwd = join(folder, String(group));
  const paths = joinable(listed);
  // What was listed under one name may have come to many programs.
  if (paths.length > 2 * namesInGroup) {
    for (let from = 0; from < paths.length; from += namesInGroup) await compare(folder, carrier, `${group}.${from / namesInGroup}`, paths.slice(from, from + namesInGroup), flags);
    return;
  }
  const parts = flags.includes("--aot-validate") ? splitForValidatingBuild(paths) : [paths];
  if (parts.length > 1) {
    for (const [index, part] of parts.entries()) await compare(folder, carrier, `${group}.${index}`, part, flags);
    return;
  }
  const made = await written(cwd, carrier, group, paths, "measure", measure);
  if (!made) return;
  const { names, build, first } = made;
  const second = await build("tested", [...flags, "--explain=statistics"]);
  expect({ build: "tested", stderr: second.exitCode ? second.stderr.slice(-2000) : "", exitCode: second.exitCode }).toEqual({ build: "tested", stderr: "", exitCode: 0 });
  // The flags did what they are here for.
  if (flags.some(flag => flag.startsWith("--aot-testing=FailPredictions"))) expect(Number(/PlacesWherePredictionsFailUnasked (\d+)/.exec(second.stderr + second.stdout)?.[1] ?? 0)).toBeGreaterThan(names.length / 2);

  // A validating build takes ten times as long.
  const isSlow = isASAN || flags.includes("--aot-validate");
  // The programs of one group parse and print texts of a million levels: together they take over a minute.
  const [expected, actual] = [await run(first.executable, cwd, {}, isASAN ? 300 : 150), await run(second.executable, cwd, {}, isSlow ? 300 : 150)];
  rmSync(cwd, { recursive: true, force: true });
  // In a slow build the clock ends slow programs, other ones in each build: that says nothing.
  const endedByClock = new Set(isSlow ? [...expected.stopped, ...actual.stopped].filter(stop => stop.endsWith(": SIGKILL")).map(stop => stop.slice(0, stop.lastIndexOf(": "))) : []);
  for (const ran of [expected, actual]) ran.stopped = ran.stopped.filter(stop => !endedByClock.has(stop.slice(0, stop.lastIndexOf(": "))));
  const differing = names.filter(name => !endedByClock.has(name) && actual.printed.get(name) !== expected.printed.get(name));
  const firstLines = (name: string) => {
    const [a, b] = [actual.printed.get(name)?.split("\n") ?? ["<not reached>"], expected.printed.get(name)?.split("\n") ?? ["<not reached>"]];
    const line = a.findIndex((text, index) => text !== b[index]);
    return `${name}, line ${line + 1}: ${(a[line] ?? "<end>").slice(0, 160)} | expected: ${(b[line] ?? "<end>").slice(0, 160)}`;
  };
  // The measure is a build of the same compiler: a program that a signal ends in both builds alike is a fault of both.
  const endedBySignal = [...new Set([...expected.stopped, ...actual.stopped])].filter(stop => !/: exit code \d+$/.test(stop));
  expect({ endedBySignal, stopped: actual.stopped, differing: differing.map(firstLines) }).toEqual({ endedBySignal: [], stopped: expected.stopped, differing: [] });
}

/**
 * Defines one test per group of about 250 programs: built with `flags`, each program prints what it prints with every function through B3.
 * The groups are split into `parts`. A run that is told nothing takes three groups of its part, which ones follows from the revision as in `partInShare`. AOT_SHARE=all takes all.
 */
export function joined(label: string, flags: string[], part = 1, parts = 1) {
  const folder = String(tempDir("aot-joined-programs", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  describe.concurrent(`compile/aot/joined/${label}`, () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    const groups = groupsOf(programsOfOneFile());
    const carrier = withoutDebugInformation();
    const [first, step] = partInShare(part, parts, Math.max(1, Math.ceil(groups.length / parts / groupsInShare)), true).split("/").map(Number);
    for (let group = first - 1; group < groups.length; group += step) {
      const listed = groups[group];
      const nameOf = (path: string) => inPrograms(path).replaceAll("\\", "/");
      test(`group ${group}: ${nameOf(listed[0])} to ${nameOf(listed.at(-1)!)}`, () => slot(() => compare(folder, carrier, group, listed, flags)), 900_000);
    }
    if (first > groups.length) test.skip("no group selected", () => {});
  });
}

type Way = { name: string; flags: string[]; env?: Record<string, string> };

/** `waysOf` is asked twice: whether there is any way at all, and, with what `--explain=statistics` says of the usual build, which. */
async function compareWays(folder: string, carrier: string[], group: number | string, listed: string[], waysOf: (group: string, statistics?: string) => Way[], mustBeMet = false) {
  const began = performance.now();
  const cwd = join(folder, String(group));
  const paths = joinable(listed);
  if (paths.length > 2 * namesInGroup) {
    for (let from = 0; from < paths.length; from += namesInGroup) await compareWays(folder, carrier, `${group}.${from / namesInGroup}`, paths.slice(from, from + namesInGroup), waysOf, mustBeMet);
    return;
  }
  if (waysOf(String(group)).length === 0) return;
  const made = await slot(() => written(cwd, carrier, group, paths, "usual", ["--explain=statistics"]));
  if (!made) return;
  const ways = waysOf(String(group), made.first.stderr + made.first.stdout);
  const [plain, usual] = await Promise.all([slot(() => run([bunExe(), "run", "--no-install", "group.ts"], cwd)), slot(() => run(made.first.executable, cwd))]);
  rmSync(made.first.executable, { force: true });

  const reds: string[] = [];
  const says = (way: string, what: string) => {
    const line = `${way} group ${group}: ${what}`;
    if (process.env.AOT_WAYS_REPORT) appendFileSync(process.env.AOT_WAYS_REPORT, line + "\n");
    return line;
  };
  const differing = (ran: Ran, names: string[]) =>
    names
      .filter(name => ran.printed.get(name) !== plain.printed.get(name))
      .map(name => {
        const [a, b] = [ran.printed.get(name)?.split("\n") ?? ["<not reached>"], plain.printed.get(name)?.split("\n") ?? ["<not reached>"]];
        const line = a.findIndex((text, index) => text !== b[index]);
        if (process.env.AOT_WAYS_KEEP) copyFileSync(join(cwd, "programs", name), join(process.env.AOT_WAYS_KEEP, name.replaceAll("/", "--")));
        return `${name}, line ${line + 1}: ${(a[line] ?? "<end>").slice(0, 160)} | expected: ${(b[line] ?? "<end>").slice(0, 160)}`;
      });
  says("met", [...(made.first.stderr + made.first.stdout).matchAll(/^(\w+)Hits ([1-9]\d*)$/gm)].map(match => `${match[1]} ${match[2]}`).join(", "));
  // What a program does otherwise than in plain Bun with no flag at all is not what the flags did. Other tests are there for it.
  const otherwiseAnyway = new Set([...differing(usual, made.names).map(line => line.slice(0, line.indexOf(","))), ...[...plain.stopped, ...usual.stopped].map(stop => stop.slice(0, stop.lastIndexOf(": ")))]);
  for (const name of otherwiseAnyway) console.error(says("usual", `${name}: not as in plain Bun`));
  const names = made.names.filter(name => !otherwiseAnyway.has(name));

  await Promise.all(
    ways.map(way =>
      slot(async () => {
        // The runner gives a file five minutes, twice that under a sanitizer. In a run that is told nothing, a way whose turn comes late is left to another run.
        if (!process.env.AOT_WAYS && !process.env.AOT_WAYS_FILE && process.env.AOT_SHARE !== "all" && performance.now() - began > (isASAN ? 340_000 : 170_000)) return void console.error(says(way.name, "not tried: its turn came late"));
        const name = `built-${way.name.replace(/[^A-Za-z0-9]+/g, "-")}`;
        let built = await made.build(name, [...way.flags, "--explain=statistics"], { ...bunEnv, ...way.env });
        // A limit that no program of the group has met was not tried.
        const met = new RegExp(`^${way.name.split(":")[0]}Hits (\\d+)$`, "m").exec(built.stderr + built.stdout)?.[1];
        // What is declared int32 has to be proven, and a proof takes the work that limits bound: past them the error at build time is the answer.
        if (built.exitCode === 1 && /^error: TS100031: /m.test(built.stderr)) return void says(way.name, "not judged: a declared int32 is no longer proven");
        if (built.exitCode !== 0) {
          reds.push(says(way.name, `the build ended with ${built.signal ?? `exit code ${built.exitCode}`}: ${(/^error: .*$/m.exec(built.stderr)?.[0] ?? built.stderr.trim().split("\n").slice(-3).join(" | ")).slice(0, 300)}`));
          // The compiler checks its own work only where it is tested. What somebody else would have got is run as well.
          if (!/internal compiler error/.test(built.stderr)) return;
          built = await made.build(name, way.flags, { ...bunEnv, ...way.env, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: undefined });
          if (built.exitCode !== 0) return void reds.push(says(way.name, `unchecked, the build ended with ${built.signal ?? `exit code ${built.exitCode}`}: ${(/^error: .*$/m.exec(built.stderr)?.[0] ?? "").slice(0, 300)}`));
        }
        const ran = await run(built.executable, cwd, way.env);
        rmSync(built.executable, { force: true });
        // Past a limit a program is slower, by how much nobody says: what the clock ended is not judged.
        const byClock = ran.stopped.filter(stop => stop.endsWith(": SIGKILL"));
        const found = [...ran.stopped.filter(stop => !byClock.includes(stop)).map(stop => `stopped in ${stop}`), ...differing(ran, names.filter(name => !byClock.some(stop => stop.startsWith(name + ": "))))];
        for (const what of found) reds.push(says(way.name, what));
        if (mustBeMet && !Number(met)) reds.push(says(way.name, "no program is beyond the limit"));
        if (found.length === 0) says(way.name, `same, ${names.length} programs${met === undefined ? "" : `, met ${met} times`}`);
      }),
    ),
  );
  rmSync(cwd, { recursive: true, force: true });
  expect(reds).toEqual([]);
}

/**
 * A limit decides how fast and how large the code is, never what a program prints. Most limits are so high that only a large program meets them, and no small program runs
 * what lies beyond. Here each is lowered to 0, 1 and 2, one in a build, and all of them together (All), so that every program is beyond it. Each program prints what it prints in plain Bun.
 *
 * A run that is told nothing takes one group of its part, All, and one in `oneIn` of the limits, which ones follows from the revision. AOT_SHARE=all takes all.
 * AOT_WAYS=<regular expression> takes the limits whose <name>:<value> it matches, AOT_GROUPS=<i>/<n> every n-th group from the i-th, AOT_BUILD_FLAGS=<flags> go to
 * every build. AOT_WAYS_REPORT=<file> gets a line for each build, AOT_WAYS_KEEP=<folder> the programs that print something else. AOT_WAYS_FILE=<file> holds other ways to build and run in place of the limits: [{ name, flags, env }].
 */
export function joinedWithLimitsLowered(part = 1, parts = 1, oneIn = isASAN ? 96 : 24) {
  const folder = String(tempDir("aot-joined-programs", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  describe.concurrent("compile/aot/joined/limits-lowered", () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    const groups = groupsOf(programsOfOneFile());
    const carrier = [...withoutDebugInformation(), ...(process.env.AOT_BUILD_FLAGS?.split(" ") ?? [])];
    const wanted = process.env.AOT_WAYS ? new RegExp(process.env.AOT_WAYS) : undefined;
    const ways = (process.env.AOT_WAYS_FILE ? (JSON.parse(readFileSync(process.env.AOT_WAYS_FILE, "utf8")) as Way[]) : limitsLowered(bunExe(), bunEnv, !!wanted)).filter(way => !wanted || wanted.test(way.name));
    const [first, step] = (process.env.AOT_GROUPS || partInShare(part, parts, Math.max(1, Math.ceil(groups.length / parts)), true)).split("/").map(Number);
    for (let group = first - 1; group < groups.length; group += step) {
      const listed = groups[group];
      const nameOf = (path: string) => inPrograms(path).replaceAll("\\", "/");
      const waysOf = (group: string) => ways.filter(way => wanted || way.name.startsWith("All:") || inShare(`${group} ${way.name}`, oneIn, true));
      test(`group ${group}: ${nameOf(listed[0])} to ${nameOf(listed.at(-1)!)}`, () => compareWays(folder, carrier, group, listed, waysOf), 900_000 + (process.env.AOT_SHARE === "all" ? 86_400_000 : 0));
    }
    if (first > groups.length) test.skip("no group selected", () => {});
  });
}

/**
 * On ARM64 a call reaches 128 MB. In a larger program a call between functions that lie further apart goes through a jump behind the caller, and the code that all functions share
 * is there several times, each copy within reach of its callers. No test program is that large, so the reach is lowered. The same groups in every run, one a part.
 * A copy serves the functions that lie within the reach less its own size, on either side. So the reach goes by the size of the shared code, which differs from group to group and
 * is four times as large where Bun was built with assertions: at one and a quarter times that size the copies take about twice the room of the functions.
 */
export function joinedBeyondTheReachOfCalls(part = 1, parts = 1) {
  const folder = String(tempDir("aot-joined-programs", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  describe("compile/aot/joined/beyond-the-reach-of-calls", () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    const groups = groupsOf(programsOfOneFile());
    const waysOf = (_: string, statistics = "") => {
      const sharedCodeSize = Number(/^SharedCodeBytesEmitted (\d+)$/m.exec(statistics)?.[1] ?? 0);
      return ["FunctionCallReach:0", `DirectCallReach:${Math.ceil(1.25 * sharedCodeSize)}`].map(name => ({ name, flags: [`--aot-limit=${name}`] }));
    };
    const group = Math.floor((groups.length * part) / (parts + 1));
    test(`group ${group}`, () => compareWays(folder, withoutDebugInformation(), group, groups[group], waysOf, true), 900_000);
  });
}
