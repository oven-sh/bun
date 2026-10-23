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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { inPrograms, isGroup, listWrittenPrograms, partInShare, slot, taken, unsupported, withoutCoreDump, withoutDebugInformation } from "./run-programs";

const root = join(import.meta.dir, "programs");
// Of which about 250 can be joined.
const namesInGroup = 300;
// What a script makes from a few rows of the table of built-ins is listed under one name until it is made (run-programs.ts).
const programsUnderOneName = 6;
const groupsInShare = 3;
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
  chosen.push(...listWrittenPrograms(/\.(ts|tsx|js)$/).filter(path => isGroup(path) || isOneFile(inPrograms(path).replaceAll("\\", "/"))));
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

async function run(executable: string, cwd: string): Promise<Ran> {
  let output = "";
  const stopped: string[] = [];
  for (let from = 0, starts = 0; starts < 12; starts++) {
    const ran = await spawned(withoutCoreDump([executable]), cwd, { ...bunEnv, FROM: String(from) }, 60);
    output += ran.stdout;
    if (/^== end$/m.test(ran.stdout)) break;
    const [, index, name] = [...ran.stdout.matchAll(/^== (\d+) (\S+)$/gm)].at(-1) ?? [];
    stopped.push(`${name ?? "before the first program"}: ${ran.signal ?? `exit code ${ran.exitCode}`}`);
    from = Number(index ?? from) + 1;
  }
  return { printed: byProgram(output), stopped };
}

async function compare(folder: string, carrier: string[], group: number | string, listed: string[], flags: string[]) {
  const cwd = join(folder, String(group));
  const paths = taken(listed, () => true).filter(path => isOneFile(inPrograms(path).replaceAll("\\", "/")) && !filesBeside.some(suffix => existsSync(path.replace(/\.[a-z]+$/, suffix))));
  // What was listed under one name may have come to many programs.
  if (paths.length > 2 * namesInGroup) {
    for (let from = 0; from < paths.length; from += namesInGroup) await compare(folder, carrier, `${group}.${from / namesInGroup}`, paths.slice(from, from + namesInGroup), flags);
    return;
  }
  const pathOf = new Map(paths.map(path => [inPrograms(path).replaceAll("\\", "/"), path]));
  let names = [...pathOf.keys()].filter(name => !cannotBeJoined.test(readFileSync(pathOf.get(name)!, "utf8")));
  // Nothing of the group can be joined, or the rows it was listed for came to no program.
  if (names.length === 0) return;
  for (const name of names) {
    const text = readFileSync(pathOf.get(name)!, "utf8");
    mkdirSync(dirname(join(cwd, "programs", name)), { recursive: true });
    // A TypeScript file without an import or an export is a script, whose declarations would meet those of the other programs.
    writeFileSync(join(cwd, "programs", name), name.endsWith(".js") || /^\s*(import|export)\b/m.test(text) ? text : text + "\nexport {};\n");
  }
  writeFileSync(join(cwd, "tsconfig.json"), readFileSync(join(root, "tsconfig.json"), "utf8").replace(`"../../../packages"`, JSON.stringify(join(import.meta.dir, "..", "..", "packages"))));

  const build = async (name: string, flags: string[]) => {
    const executable = join(cwd, name);
    return { ...(await spawned([bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, "group.ts", "--outfile", executable], cwd, bunEnv, 240)), executable };
  };
  // A program that the compiler refuses beside the others, for a name that two of them declare, leaves the group.
  let first = { stderr: "", exitCode: 1, executable: "" };
  for (let attempt = 0; attempt < 6 && first.exitCode; attempt++) {
    writeFileSync(join(cwd, "group.ts"), textOfGroup(names));
    first = await build("measure", measure);
    const refused = new Set([...first.stderr.matchAll(/[\\/]programs[\\/](\S+?\.(?:tsx|ts|js))/g)].map(match => match[1].replaceAll("\\", "/")));
    if (first.exitCode && !refused.size) break;
    if (first.exitCode) console.error(`LEFT OUT of group ${group}: ${[...refused].join(", ")}`);
    if (first.exitCode) names = names.filter(name => !refused.has(name));
  }
  expect({ build: "measure", stderr: first.exitCode ? first.stderr.slice(-2000) : "", exitCode: first.exitCode }).toEqual({ build: "measure", stderr: "", exitCode: 0 });
  const second = await build("tested", [...flags, "--explain=statistics"]);
  expect({ build: "tested", stderr: second.exitCode ? second.stderr.slice(-2000) : "", exitCode: second.exitCode }).toEqual({ build: "tested", stderr: "", exitCode: 0 });
  // The flags did what they are here for.
  if (flags.includes("--aot-testing=GenerateAllCodeDirectly")) expect(Number(/FunctionsGeneratedDirectly (\d+)/.exec(second.stderr + second.stdout)?.[1] ?? 0)).toBeGreaterThan(names.length / 2);

  const [expected, actual] = [await run(first.executable, cwd), await run(second.executable, cwd)];
  rmSync(cwd, { recursive: true, force: true });
  const differing = names.filter(name => actual.printed.get(name) !== expected.printed.get(name));
  const firstLines = (name: string) => {
    const [a, b] = [actual.printed.get(name)?.split("\n") ?? ["<not reached>"], expected.printed.get(name)?.split("\n") ?? ["<not reached>"]];
    const line = a.findIndex((text, index) => text !== b[index]);
    return `${name}, line ${line + 1}: ${(a[line] ?? "<end>").slice(0, 160)} | expected: ${(b[line] ?? "<end>").slice(0, 160)}`;
  };
  expect({ stopped: actual.stopped, differing: differing.map(firstLines) }).toEqual({ stopped: expected.stopped, differing: [] });
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
    if (isWindows || isASAN) return void test.skip("no code is generated directly on Windows or by a Bun built with AddressSanitizer", () => {});
    const groups = groupsOf(programsOfOneFile());
    const carrier = withoutDebugInformation();
    const [first, step] = partInShare(part, parts, Math.ceil(groups.length / parts / groupsInShare)).split("/").map(Number);
    for (let group = first - 1; group < groups.length; group += step) {
      const listed = groups[group];
      const nameOf = (path: string) => inPrograms(path).replaceAll("\\", "/");
      test(`group ${group}: ${nameOf(listed[0])} to ${nameOf(listed.at(-1)!)}`, () => slot(() => compare(folder, carrier, group, listed, flags)), 900_000);
    }
    if (first > groups.length) test.skip("no group selected", () => {});
  });
}
