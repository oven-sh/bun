// Draws programs and builds each one as a user builds it: `bun build --compile --aot <file>`, the program is the entry point and nothing else is in the executable. The executable runs as a process of its own
// and is held against `bun <file>`: what it prints, and how it ends. A difference that the executable of `bun build --compile` without --aot shows as well is counted and not kept.
//
// run-batch.ts puts a runner, Workers and other programs into the executable. What a build proves only of a program that is its own entry point, and what it leaves out because nothing else reaches it,
// it never shows there: of 31 known faulty programs run-batch.ts saw 12, each built by itself beside the runner. This driver costs a build for each program.
//
//   bun run-alone.ts --bun <the Bun that builds and runs> --work <folder> --finds <folder> [--draws ts|js] [--scene <name>,<name>] [--families 25] [--programs <folder>] [--seconds 3600]
//
// `--scene a,b` draws every program from those scenes of write-ordinary-scenes.ts, one scene to a program. Without it a program has one to three scenes of any kind.
// `--families 25` draws 25 programs of 100 from the sources of ../sources.ts that give one file.
// `--programs <folder>` takes the files of the folder, once each, in place of draws.
// `--checks-proofs 50` builds 50 programs of 100 once more with --aot-testing=CheckProofsAtRunTime or another word under which the executable checks itself, `--writes-straight 50` with --aot-testing=ForceStraightCompilation. Both executables have to do as `bun <file>` does.
// `--as-a-test 25` has a test import 25 programs of 100, under `bun test --aot` and under `bun test`. A difference counts where the compiled test run prints something else than the executable too.
// `--shuffles-costs 50` builds 50 programs of 100 once more under a word that may only change what the code costs: guesses fail unasked, expected types are ignored or shuffled, so are the frequencies of blocks and
// the choices by cost, Link is given more. An answer that changes there is a miscompilation.
// `--kin 100` draws 100 programs of 100 as kin (write-kin.ts) of the stored programs under `--stored` (../../parallel), seven of ten from those that changed within `--hours` (2) of the newest.
// `--changes-draws 30` makes the same small changes to 30 drawn programs of 100.
// `--together 10` builds ten programs into one executable first, behind an entry that imports them in a row. A build costs about the same for one small program as for ten. Where the company does as
// `bun <file>` does, all ten count as the same. Where it parts, each member is built alone in the same way. Where none parts alone, members are taken out while the rest still parts, and what is left is kept as
// `together-<kind>`. Company hides some faults and shows others, so this is a second net beside the first.
// What it keeps under --finds is laid out as run-batch.ts lays it out: <kind>-<hash of the words>/<size as a power of two>/{program.<extension>, report.txt, compiled.stdout, ..}, and index.txt.
// It prints a line with {"taken": n, ..} every 50 programs, as run-batch.ts does for each batch.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { withoutInstallingPackages } from "../../harness/without-installing-packages";
import {
  comesToTheEndOfTheStack,
  hearsWhatCodeFromStringsMayHear,
  refusesOnlyWhatThePageLists,
} from "./what-the-page-declares.ts";
import { withoutWhatKeepsTheLibrary, writeKin } from "./write-kin.ts";
import { writeOrdinaryScenes } from "./write-ordinary-scenes.ts";

const { values: options } = parseArgs({
  // lane.ts hands every driver what run-batch.ts takes.
  strict: false,
  allowPositionals: true,
  options: {
    bun: { type: "string", default: process.execPath },
    work: { type: "string" },
    finds: { type: "string" },
    draws: { type: "string", default: "ts" },
    scene: { type: "string", default: "" },
    families: { type: "string", default: "0" },
    programs: { type: "string", default: "" },
    seconds: { type: "string", default: "0" },
    flags: { type: "string", default: "--aot-threads=1" },
    "checks-proofs": { type: "string", default: "0" },
    "writes-straight": { type: "string", default: "0" },
    "as-a-test": { type: "string", default: "0" },
    "shuffles-costs": { type: "string", default: "0" },
    kin: { type: "string", default: "0" },
    stored: { type: "string", default: process.env.FUZZ_STORED_PROGRAMS ?? "" },
    hours: { type: "string", default: "2" },
    together: { type: "string", default: "1" },
    "changes-draws": { type: "string", default: "0" },
  },
});
const { bun, work, finds } = options as Record<string, string>;
for (const name of [
  "draws",
  "scene",
  "families",
  "programs",
  "seconds",
  "flags",
  "checks-proofs",
  "writes-straight",
  "as-a-test",
  "shuffles-costs",
  "kin",
  "stored",
  "hours",
  "together",
  "changes-draws",
])
  options[name] = String(options[name]);
if (!work || !finds) throw new Error("Expected --work and --finds");
withoutInstallingPackages(work);
const flags = options.flags.split(" ").filter(Boolean);
const folder = join(work, `alone-${process.pid}`);
mkdirSync(finds, { recursive: true });
/** An executable is shipped without its sources. Beside them the one without --aot reads a file from disk where a load goes by a made name, and runs it a second time. */
const away = join(work, `away-${process.pid}`);
mkdirSync(away, { recursive: true });

type Ended = { stdout: string; stderr: string; end: string; seconds: number };
async function spawn(cmd: string[], seconds: number, cwd = folder): Promise<Ended> {
  const began = performance.now();
  const child = Bun.spawn({
    cmd,
    cwd,
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return {
    stdout: stdout.slice(0, 1 << 20),
    stderr: stderr.slice(-8000),
    end: child.signalCode === "SIGKILL" ? "time" : (child.signalCode ?? String(exitCode)),
    seconds: (performance.now() - began) / 1000,
  };
}

/** `console.log(error)` prints lines of the source, a message whose words can differ, and a stack. As in run-batch.ts. */
const withoutDetails = (output: string) =>
  output
    .replace(/[ \t]*\d+ \| .*\n(?:\s*\d+ \| .*\n|[\^~ ]+\n)*/g, " ")
    .split("\n")
    .filter(line => !/^\s*(\d+ \| |[\^~ ]+$|at |(originalLine|originalColumn|sourceURL|stack): )/.test(line))
    .map(line => line.replace(/Error: .*/, "Error").replace(/\[(\w*Function): [^\]]*\]/g, "[$1]"))
    .join("\n");
const agree = (a: Ended, b: Ended) => a.end === b.end && withoutDetails(a.stdout) === withoutDetails(b.stdout);
/** The two runs differ in where the lines of a function's text break and in parentheses that change nothing. As in run-batch.ts. */
const withoutLayout = (output: string) => withoutDetails(output).replace(/\\n|%20|%0A|%09|[\s()]/g, "");
/** Where a program lies: the folder of the run, and the root inside an executable. A program that asks hears another folder there. That alone is declared: what still parts with the two taken out is a difference like any other. */
const withoutRoots = (output: string) =>
  withoutDetails(output)
    .replaceAll(realpathSync(folder), "<root>")
    .replaceAll(folder, "<root>")
    .replaceAll("/$bunfs/root", "<root>")
    // What `process.argv` begins with.
    .replaceAll(bun, "bun")
    .replace(/<root>\/(?:program\.\w+|executable|plain-executable)\b/g, "<entry>");
const isDocumented = (text: string, ours: Ended, plain: Ended) =>
  refusesOnlyWhatThePageLists(ours) ||
  comesToTheEndOfTheStack(plain) ||
  hearsWhatCodeFromStringsMayHear(text, ours) ||
  ["WeakRef", "FinalizationRegistry", ".finalization", ".stack", ".caller"].some(name => text.includes(name));
/** The two printed the same lines, each as often, in another order. */
const sameLinesInAnotherOrder = (a: Ended, b: Ended) =>
  withoutDetails(a.stdout).split("\n").sort().join("\n") === withoutDetails(b.stdout).split("\n").sort().join("\n");
/** Whether the first text is the second with some of its lines left out. */
function lacksOnlyLines(less: string, more: string) {
  const wanted = less.split("\n").filter(line => !line.startsWith("bun test v"));
  let at = 0;
  for (const line of more.split("\n")) if (at < wanted.length && line === wanted[at]) at++;
  return at === wanted.length;
}
const stopAtAFalseProof = /^bun: internal AOT error: .*$/m;

/** `plain` and `plainAgain` are two runs of the reference, `ours` is the second run of what was compiled. */
function kindOfDifference(text: string, plain: Ended, plainAgain: Ended, ours: Ended) {
  if (!agree(plain, plainAgain)) return "the reference is unsteady";
  if (agree(ours, plainAgain)) return "unsteady";
  // What `bun <file>` does in a moment and the executable not in forty seconds is no matter of speed.
  if (ours.end === "time") return plain.seconds < 1 && plainAgain.seconds < 1 ? "never-ends" : "limit";
  if (stopAtAFalseProof.test(ours.stderr)) return "false-proof";
  // No page declares a death.
  if (/^SIG/.test(ours.end) || Number(ours.end) >= 128) return "signal";
  if (ours.end === plainAgain.end && withoutLayout(ours.stdout) === withoutLayout(plainAgain.stdout))
    return "function source";
  // Where the first line on which they part is a line of the program itself, `bun <file>` prints the source of a function.
  const [left, right] = [withoutDetails(ours.stdout).split("\n"), withoutDetails(plainAgain.stdout).split("\n")];
  const parting = (right[left.findIndex((each, at) => each !== right[at])] ?? "").trim();
  if (
    (parting.length > 12 && /[{};]|=>/.test(parting) && text.includes(parting)) ||
    /^(?:async )?function\b.*\{$|^class\b.*\{$|=> \{$|\) \{$|^(?:let|const|var|return|if|for|while|try) .*[;{]$/.test(
      parting,
    )
  )
    return "function source";
  // The source of a library function is not in the executable.
  if (ours.stdout.includes("{ [native code] }") && !plainAgain.stdout.includes("{ [native code] }"))
    return "function source";
  // A message that names the file of the program names another folder in an executable.
  if (ours.end === plainAgain.end && withoutRoots(ours.stdout) === withoutRoots(plainAgain.stdout))
    return "documented difference";
  if (isDocumented(text, ours, plainAgain)) return "documented difference";
  return ours.end !== plainAgain.end ? "exit-code" : "stdout";
}
const kept = ["false-proof", "signal", "exit-code", "stdout", "limit", "never-ends"];
function firstDifference(ours: Ended, plain: Ended) {
  const [left, right] = [withoutDetails(ours.stdout).split("\n"), withoutDetails(plain.stdout).split("\n")];
  const line = left.findIndex((each, at) => each !== right[at]);
  const said = stopAtAFalseProof.exec(ours.stderr)?.[0];
  return `compiled: ${ours.end}${said ? " | " + said : ""}\nbun run:  ${plain.end}\ncompiled: ${(left[line] ?? "").slice(0, 400)}\nbun run:  ${(right[line] ?? "").slice(0, 400)}\n`;
}

function keepFind(kind: string, summary: string, files: Record<string, string>) {
  const group = `${kind}-${Bun.hash
    .crc32(summary.replace(/[0-9a-f]/gi, ""))
    .toString(16)
    .padStart(8, "0")}`;
  const name = `${group}/${Math.floor(Math.log2(Math.max(1, Object.values(files)[0].length)))}`;
  if (existsSync(join(finds, name))) return;
  mkdirSync(join(finds, name), { recursive: true });
  // What a run printed is cut. A program is kept whole: a cut one cannot be asked again.
  for (const [file, text] of Object.entries(files))
    writeFileSync(join(finds, name, file), /^(?:program|stored)\./.test(file) ? text : text.slice(0, 256 << 10));
  appendFileSync(join(finds, "index.txt"), name + "\n");
}

type Family = (
  seed: number,
  bed: unknown,
) => { text: string; extension: string; flags?: string[]; files?: unknown; meant?: Drawn["meant"] } | undefined;
let families: [string, Family][] = [];
if (Number(options.families) > 0) {
  const { allSources } = await import("../sources.ts");
  families = Object.entries(await allSources(join(import.meta.dir, "..", "..", "parallel"), new Set())) as [
    string,
    Family,
  ][];
}
const bed = { name: "product", binary: "", accepts: () => true, allows: () => true, batch: 1 };
const scenes = options.scene.split(",").filter(Boolean);
const given = options.programs
  ? readdirSync(options.programs)
      .filter(name => /\.[cm]?[jt]s$/.test(name))
      .sort()
  : undefined;

const stored = options.stored || join(import.meta.dir, "..", "..", "parallel");
const pools: { late: string[]; all: string[] } = { late: [], all: [] };
if (Number(options.kin) > 0) {
  const changed = new Map<string, number>();
  for (const name of new Bun.Glob("**/*.{ts,js,mjs,cjs,mts,cts}").scanSync({ cwd: stored })) {
    // The folder may be laid anew while it is read.
    const { mtimeMs = 0, size = Infinity } = statSync(join(stored, name), { throwIfNoEntry: false }) ?? {};
    const isForAnotherProcessor = /^(x64|arm64)-alone\//.test(name) && !name.startsWith(process.arch);
    if (size < 16_000 && !name.endsWith(".d.ts") && !name.includes(".test.") && !isForAnotherProcessor)
      changed.set(name, mtimeMs);
  }
  const newest = Math.max(...changed.values());
  pools.all = [...changed.keys()];
  pools.late = pools.all.filter(name => changed.get(name)! > newest - Number(options.hours) * 3_600_000);
}
/** A stored program that stands alone and prints the same wherever it lies. */
const standsAlone = (text: string) =>
  !/from "\.|require\("\.|import\("\.|import "\.|bun:test|Plain Bun prints another output|[Cc]ompiled executable|[Ee]xecutable refuses|[Pp]lain Bun|@ts-expect-error|@ts-ignore|import\.meta|\.argv|\.execPath|Bun\.main|__filename|__dirname|^\/\/ (?:Env|Flags|Options|Arguments|@filename)/m.test(
    text,
  );
function drawKin() {
  for (let tries = 0; tries < 40; tries++) {
    const pool = pools.late.length && Math.random() < 0.7 ? pools.late : pools.all;
    // A folder first, then a file in it: a family of hundreds of files must not crowd out the one program that came with a unit.
    const folders = [...new Set(pool.map(name => name.split("/")[0]))];
    const folder = folders[Math.floor(Math.random() * folders.length)];
    const inFolder = pool.filter(name => name.split("/")[0] === folder);
    const name = inFolder[Math.floor(Math.random() * inFolder.length)];
    if (!existsSync(join(stored, name))) continue;
    const text = readFileSync(join(stored, name), "utf8").replace(/^\/\* Output:\n[^]*?\*\/\n?/m, "");
    // An executable refuses stores on globals and built-ins, and a stored program about them says so in what it prints. Its kin would not.
    if (!standsAlone(text) || changesTheWorld.test(text)) continue;
    const kin = writeKin(text, Math.random);
    if (kin.changes.length)
      return {
        text: `${kin.text}\n// kin of ${name}: ${kin.changes.join(", ")}\n`,
        extension: extname(name),
        isKin: true,
        from: { name, text },
      };
  }
}

type Arm = [prefix: string, flags: string[]];
type Company = { members: Drawn[]; left: number; found: number; arm: Arm };
type Drawn = {
  text: string;
  extension: string;
  isKin?: boolean;
  from?: { name: string; text: string };
  /** Why the two runs may print these two texts, where the source of the program knows of an intended difference. */
  meant?: (plain: string, compiled: string) => string | undefined;
  /** The programs that this one imports in a row. */
  members?: Drawn[];
  /** The ways to build it, where they are not drawn. */
  arms?: Arm[];
  /** The company that parted, for one of its members. */
  company?: Company;
  /** None of its members parts alone. */
  isCompany?: boolean;
};
/** One draw of two goes without what keeps the library: see withoutWhatKeepsTheLibrary(). One member that keeps it keeps it for all, so a company takes one coin. */
function draw(keepsLittle = !given && Math.random() < 0.5): Drawn | undefined {
  const drawn = drawAsItPrints();
  if (drawn && keepsLittle && !drawn.text.includes("// @filename: "))
    drawn.text = withoutWhatKeepsTheLibrary(drawn.text, /ts$/.test(drawn.extension)) ?? drawn.text;
  return drawn;
}
function drawAsItPrints(): Drawn | undefined {
  if (Math.random() * 100 < Number(options.kin)) {
    const kin = drawKin();
    if (kin) return kin;
  }
  const drawn = drawAScene();
  // A scene stands where a fault once stood. Its kin stand beside it.
  if (!drawn || drawn.text.includes("// @filename: ") || Math.random() * 100 >= Number(options["changes-draws"]))
    return drawn;
  const kin = writeKin(drawn.text, Math.random);
  if (!kin.changes.length) return drawn;
  const name = `a draw ${Bun.hash.crc32(drawn.text).toString(16)}`;
  return {
    ...drawn,
    text: `${kin.text}\n// kin of ${name}: ${kin.changes.join(", ")}\n`,
    isKin: true,
    from: { name, text: drawn.text },
  };
}
function drawAScene(): Drawn | undefined {
  if (given) {
    const name = given.shift();
    return name === undefined
      ? undefined
      : { text: readFileSync(join(options.programs, name), "utf8"), extension: extname(name) };
  }
  const seed = Math.floor(Math.random() * 2 ** 48);
  while (Math.random() * 100 < Number(options.families)) {
    const [name, family] = families[Math.floor(Math.random() * families.length)];
    try {
      const drawn = family(seed % 2 ** 31, bed);
      if (drawn && !drawn.flags?.length && !drawn.files && drawn.extension.endsWith(options.draws))
        return {
          text: `${drawn.text}\n// ${name} ${seed % 2 ** 31}\n`,
          extension: "." + drawn.extension,
          meant: drawn.meant,
        };
    } catch {}
  }
  const start = `const printValue = console.log;\n// ${seed.toString(36)}\nexport {};\n`;
  const text = writeOrdinaryScenes(
    start,
    options.draws === "ts",
    scenes.length ? scenes[seed % scenes.length] : undefined,
    scenes.length ? 1 : undefined,
  );
  // A text that needs nothing of a module is a CommonJS file now and then, and always where it says that it stays a script.
  const script = text.replace(/^export \{\};\n/gm, "");
  const staysAScript = script.includes("// stays a script");
  const [own, ...files] = script.split(/^\/\/ @filename: /m);
  const canBeAScript = !/^\s*(?:import|export)\b|\bawait\b/m.test(own) && (staysAScript || !files.length);
  if (canBeAScript && (staysAScript || Math.random() < 0.25))
    return { text: script, extension: options.draws === "ts" ? ".cts" : ".cjs" };
  return staysAScript ? drawAScene() : { text, extension: "." + options.draws };
}

/** One executable for several programs: an entry that imports them in a row, each in a folder of its own. */
function together(members: Drawn[]): Drawn {
  const files = members.map((member, at) => {
    const [main, ...others] = member.text.split(/^\/\/ @filename: \.\/(\S+)\n/m);
    let text = `// @filename: ./k${at}/program${member.extension}\n${main.replace(/\n?$/, "\n")}`;
    for (let other = 0; other < others.length; other += 2)
      text += `// @filename: ./k${at}/${others[other]}\n${others[other + 1].replace(/\n?$/, "\n")}`;
    return text;
  });
  const entry = members.map((member, at) => `import "./k${at}/program${member.extension}";\n`).join("");
  return { text: entry + files.join(""), extension: ".ts", members };
}
function lay({ text, extension }: Drawn) {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const [main, ...others] = text.split(/^\/\/ @filename: \.\/(\S+)\n/m);
  writeFileSync(join(folder, "program" + extension), main);
  for (let other = 0; other < others.length; other += 2) {
    mkdirSync(dirname(join(folder, others[other])), { recursive: true });
    writeFileSync(join(folder, others[other]), others[other + 1]);
  }
  return others.length > 0;
}
const build = (more: string[], entry: string, out: string) => [
  ...[bun, "build", "--compile", "--aot", ...flags, ...more],
  ...["./" + entry, "--outfile", join(folder, out)],
];

const counts: Record<string, number> = { taken: 0 };
const add = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
/** Programs that are judged before anything new is drawn. */
const waiting: Drawn[] = [];
// How deep calls can go is asked of the executable as users build it, with nothing beside the program.
const asksForDepth = /^function visit_\d+\(depth/m;
const endsTheProcess = /process\.(?:exit|abort|kill|reallyExit|on|once)\b|uncaughtException|unhandledRejection/;
// When an `import()` settles against what a module beside it awaits is an order of loads.
const loadsLate = /\bimport\(/;
// Whether a timer of no delay rings in front of an immediate of another member hangs on how long the start took, and an executable starts faster.
const waitsForTheClock = /\bset(?:Timeout|Immediate|Interval)\b/;
// What one program does to a global or to a built-in, its neighbors would meet (the classes of a drawn scene end in its number): an executable refuses some of it, and then they part for no fault of their own.
const changesTheWorld =
  /globalThis(?:\.\w+|\[[^\]]+\]| as any\)(?:\.\w+|\[[^\]]+\]))\s*=[^=]|\bprocess\s*(?:\+\+|--|[-+*]?=[^=])|\b[A-Z]\w*[A-Za-z]\.prototype(?:\.\w+|\[[^\]]+\]| as any\)(?:\.\w+|\[[^\]]+\]))\s*=[^=]|Object\.(?:defineProperty|defineProperties|setPrototypeOf|assign|freeze)\((?:globalThis|process|[A-Z]\w*[A-Za-z](?:\.prototype)?)\b|\bdelete (?:globalThis|process|[A-Z]\w*[A-Za-z])\b/;

/** So many programs that `bun <file>` runs to their end, as one. What cannot stand in company waits to be judged alone. */
async function drawTogether(size: number): Promise<Drawn | undefined> {
  const members: Drawn[] = [];
  const keepsLittle = !given && Math.random() < 0.5;
  for (let tries = 0; members.length < size && tries < size * 4; tries++) {
    const program = draw(keepsLittle);
    if (!program) break;
    lay(program);
    const plain = await spawn([bun, "program" + program.extension], 20);
    const canStandInCompany = ![endsTheProcess, asksForDepth, loadsLate, waitsForTheClock, changesTheWorld].some(
      pattern => pattern.test(program.text),
    );
    if (plain.end === "0" && canStandInCompany) members.push(program);
    else if (!program.isKin || plain.end === "0") waiting.push(program);
    else {
      counts.taken++;
      add("a kin that bun <file> does not run to its end");
    }
  }
  return members.length > 1 ? together(members) : (members[0] ?? waiting.shift());
}

/** The compiler's own checks of the code that it makes. They stand beside a word, never in the build as it ships: they change the frame, and a fault has hidden behind that. Under a word that may only change cost a coin decides. */
const ownChecks = "--aot-check=Validate";
function drawArms(text: string): Arm[] {
  // A program may name the flags that it is to be built with in its first line.
  const named = /^\/\/ Flags: (.+)\n/.exec(text);
  if (named) return [[`${named[1].replace(/^--aot-testing=|:.*/g, "")}-`, named[1].split(" ")]];
  const arms: Arm[] = [["", []]];
  if (asksForDepth.test(text)) return arms;
  // One time in two the walk is held against itself beside the proofs: under that word every typed read by name asks again what an inquiry finds, so each such read in a drawn program is an oracle of its own.
  if (Math.random() * 100 < Number(options["checks-proofs"]))
    arms.push(
      Math.random() < 0.5
        ? ["proof-checks-", ["--aot-testing=CheckProofsAtRunTime", ownChecks]]
        : ["checks-CheckWalkAtRunTime-", ["--aot-testing=CheckProofsAtRunTime,CheckWalkAtRunTime", ownChecks]],
    );
  // The other words under which the executable checks itself while it runs, or is built with more tests than it needs. Every answer stays. Half as often, and beside the arm above, not in its place.
  if (Math.random() * 200 < Number(options["checks-proofs"])) {
    const word = [
      "CheckEffectsAtRunTime",
      "CheckEffectsAtRunTime",
      "CheckProofsAtEntries",
      "CheckProofsAtEntriesAndFields",
      "CheckBoundsAtRunTime",
      "DisableFrameCells",
      "DelayFlowRules",
      "DelayOtherFlowRules",
    ][Math.floor(Math.random() * 8)];
    arms.push([`checks-${word.replace(/.*,/, "")}-`, [`--aot-testing=${word}`, ownChecks]]);
  }
  if (Math.random() * 100 < Number(options["writes-straight"]))
    arms.push(["straight-", ["--aot-testing=ForceStraightCompilation", ownChecks]]);
  if (Math.random() * 100 < Number(options["shuffles-costs"])) {
    const seed = 1 + Math.floor(Math.random() * 1000);
    const word = [
      "IgnoreBranchHints",
      `ShuffleBlockFrequencies:${seed}`,
      "IgnoreExpectedTypes",
      `ShuffleExpectedTypes:${seed}`,
      "FailSpeculations",
      // Every n-th guess fails. With n over one a typed copy of a loop is entered and then left for its closed copy in the middle of ordinary turns; with one, the tests in front fail too and no typed copy is entered.
      `FailSpeculations:${[2, 3, 7][seed % 3]}:${seed}`,
      `FailSpeculations:${[2, 3, 7][seed % 3]}:${seed}`,
      `FailSpeculations:${[2, 3, 7][seed % 3]}:${seed}`,
      `WidenFlowNodes:${seed}`,
      `ShuffleChoices:${seed}`,
      "ForceFallbackBlockOrder",
      "ForceWalkMode:NothingCarried",
      "ForceWalkMode:Closed",
      `ForceWalkMode:${seed & 1 ? "NothingCarried" : "Closed"}:${2 + (seed % 3)}:${seed}`,
      `AbortLoopVisits:${1 + (seed % 13)}:${seed % (1 + (seed % 13))}`,
    ][Math.floor(Math.random() * 15)];
    arms.push([
      `cost-${word.replace(/:.*/, "")}-`,
      [
        `--aot-testing=${word}`,
        ...(word.startsWith("WidenFlowNodes") ? ["--aot-check=FlowMonotonicity"] : []),
        ...(Math.random() < 0.5 ? [ownChecks] : []),
      ],
    ]);
  }
  return arms;
}

/** Some stored programs are held to an output of their own. A kin that parts counts where the stored program does as `bun <file>` does: each is asked once for each way to build. */
const isAsPlain = new Map<string, boolean>();
async function comesOfAnOddProgram({ from, extension }: Drawn, [arm, more]: Arm) {
  if (!from) return false;
  const key = arm + from.name;
  if (!isAsPlain.has(key)) {
    writeFileSync(join(folder, "stored" + extension), from.text);
    const reference = await spawn([bun, "stored" + extension], 20);
    await spawn(build(more, "stored" + extension, "stored"), 300);
    isAsPlain.set(
      key,
      reference.end === "0" &&
        existsSync(join(folder, "stored")) &&
        agree(await spawn([join(folder, "stored")], 40), reference),
    );
    rmSync(join(folder, "stored"), { force: true });
  }
  if (isAsPlain.get(key)) return false;
  for (const pool of [pools.late, pools.all]) if (pool.includes(from.name)) pool.splice(pool.indexOf(from.name), 1);
  add("a stored program that does not do as bun <file> does");
  return true;
}

/** Takes out of a company each member without which it still parts. */
async function withoutBystanders(company: Drawn, [, more]: Arm) {
  let members = company.members!;
  for (let at = members.length - 1; at >= 0 && members.length > 1; at--) {
    const fewer = together(members.toSpliced(at, 1));
    lay(fewer);
    const plain = await spawn([bun, "program.ts"], 60);
    await spawn(build(more, "program.ts", "executable"), 300);
    if (!existsSync(join(folder, "executable")) || !agree(await spawn([join(folder, "executable")], 80), plain))
      members = fewer.members!;
  }
  return { ...company, ...together(members) };
}

const lastStart = Number(options.seconds) ? performance.now() + Number(options.seconds) * 1000 : Infinity;
let started = performance.now();
function tell() {
  console.log(
    `${new Date().toISOString().slice(11, 19)} ${(counts.taken / ((performance.now() - started) / 1000)).toFixed(1)} programs a second | ${JSON.stringify(counts)}`,
  );
  for (const kind in counts) counts[kind] = 0;
  started = performance.now();
}
while (performance.now() < lastStart || waiting.length) {
  let program =
    waiting.shift() ?? (Number(options.together) > 1 ? await drawTogether(Number(options.together)) : draw());
  if (!program) break;
  if (program.isCompany) program = await withoutBystanders(program, program.arms![0]);
  const { text, extension, members, isCompany, company, meant } = program;
  const hasFiles = lay(program);
  if (!program.arms) counts.taken += members?.length ?? 1;
  const inCompany = isCompany ? "together-" : "";
  const plain = await spawn([bun, "program" + extension], members ? 60 : 20);
  let asBuilt: Ended | undefined;
  /** Whether anything but "same" came of it. */
  let parted = false;
  if (plain.end === "time") add("bun <file> does not end in time");
  else if (program.isKin && plain.end !== "0") add("a kin that bun <file> does not run to its end");
  else
    for (const [arm, more] of program.arms ?? drawArms(text)) {
      const command = build(more, "program" + extension, "executable");
      const built = await spawn(command, 300);
      const report = (kind: string, words: string) =>
        `${kind}, ${isCompany ? "programs built together: an entry imports them in a row, and none of them parts where it is built alone" : "the program built alone as its own entry point"}\n${command.join(" ")}\n${words}`;
      // A company that parts says only that one of its members may: each is then built alone in the same way.
      const suspectAll = () => {
        add(`${arm}a company parts`);
        const record: Company = { members: members!, left: members!.length, found: 0, arm: [arm, more] };
        for (const member of members!) waiting.push({ ...member, arms: [[arm, more]], company: record });
      };
      if (!existsSync(join(folder, "executable"))) {
        const stop = /internal compiler error.*$|Stopped while compiling.*$|^panic.*$|^AOT: .*$|^bun: internal AOT error: .*$/m.exec(
          built.stderr + built.stdout,
        )?.[0];
        if (stop === undefined && built.end === "1") {
          add(`${arm}refused`);
          // One member that the build refuses takes its company along.
          if (members && !isCompany && arm === "") suspectAll();
          parted = true;
          break;
        }
        if (members && !isCompany) {
          suspectAll();
          break;
        }
        parted = true;
        if (await comesOfAnOddProgram(program, [arm, more])) break;
        add(`${inCompany}${arm}build-stopped`);
        const words = `${built.end}: ${(stop ?? "").replace(/'[^'\n]*'|\bat \S+|\bfunction \S+/g, "")}`;
        keepFind(`${inCompany}${arm}build-stopped`, words, {
          ["program" + extension]: text,
          "report.txt": report("build-stopped", `${built.end}: ${stop ?? ""}\n`),
          "compiler.stderr": built.stderr,
        });
        continue;
      }
      let ours = await spawn([join(folder, "executable")], members ? 80 : 40);
      if (arm === "") asBuilt = ours;
      if (agree(ours, plain)) {
        add(`${inCompany}${arm}same`);
        rmSync(join(folder, "executable"), { force: true });
        continue;
      }
      if (members && !isCompany) {
        rmSync(join(folder, "executable"), { force: true });
        suspectAll();
        break;
      }
      parted = true;
      // A difference counts when a second pair of runs shows it again.
      const [plainAgain, oursAgain] = [
        await spawn([bun, "program" + extension], 40),
        await spawn([join(folder, "executable")], 80),
      ];
      rmSync(join(folder, "executable"), { force: true });
      const kind = meant?.(plainAgain.stdout, oursAgain.stdout)
        ? "documented difference"
        : kindOfDifference(text, plain, plainAgain, oursAgain);
      ours = oursAgain;
      // Where `bun build --compile` without --aot parts from `bun <file>` too, and in the same way, the bundler and the runner read something differently: a tsconfig.json in a folder, the path of
      // a file, when an `import()` settles. That is no fault of the compiler.
      if (kind === "stdout" || kind === "exit-code") {
        await spawn(
          [bun, "build", "--compile", "./program" + extension, "--outfile", join(folder, "plain-executable")],
          300,
        );
        const bundled = existsSync(join(folder, "plain-executable"))
          ? await spawn([join(folder, "plain-executable")], 40, away)
          : undefined;
        rmSync(join(folder, "plain-executable"), { force: true });
        if (bundled && agree(ours, bundled)) {
          add(inCompany + arm + "as the executable without --aot");
          continue;
        }
        // In which order files are loaded differs between `bun <file>` and the executable without --aot, and from run to run. It counts where those two agree and `bun <file>` says the same twenty
        // times. So does whatever only a company shows.
        if (isCompany || (hasFiles && /\bimport\(|\brequire\(/.test(text))) {
          if (!bundled || !agree(bundled, plainAgain)) {
            add(inCompany + arm + "an order of loads on which bun <file> and the executable without --aot part");
            continue;
          }
          let holds = true;
          for (let again = 0; holds && again < 18; again++)
            holds = agree(await spawn([bun, "program" + extension], 40), plainAgain);
          if (!holds) {
            add(inCompany + arm + "an order of loads in which bun <file> wavers");
            continue;
          }
        }
      }
      if (kept.includes(kind) && (await comesOfAnOddProgram(program, [arm, more]))) break;
      add(inCompany + arm + kind);
      if (!kept.includes(kind)) continue;
      const summary = firstDifference(ours, plainAgain);
      keepFind(inCompany + arm + kind, summary, {
        ["program" + extension]: text,
        "report.txt": report(arm + kind, summary),
        "compiled.stdout": ours.stdout,
        "compiled.stderr": ours.stderr,
        "bun-run.stdout": plainAgain.stdout,
        "bun-run.stderr": plainAgain.stderr,
      });
    }
  if (company) {
    if (parted) company.found++;
    // Nobody parts alone: then it takes the company.
    if (--company.left === 0 && company.found === 0)
      waiting.push({ ...together(company.members), isCompany: true, arms: [company.arm] });
  }
  if (asBuilt && !members && !program.arms && Math.random() * 100 < Number(options["as-a-test"])) {
    writeFileSync(
      join(folder, "wrapped.test.js"),
      `import { test } from "bun:test";\ntest("the program", async () => {\n  await import("./program${extension}");\n});\n`,
    );
    const command = [bun, "test", "--aot", "./wrapped.test.js"];
    const both = async () => [await spawn([bun, "test", "./wrapped.test.js"], 60), await spawn(command, 300)];
    const [reference, first] = await both();
    if (reference.end === "time") add("bun test does not end in time");
    else if (agree(first, reference)) add("test-run-same");
    else {
      const [referenceAgain, ours] = await both();
      let kind = kindOfDifference(text, reference, referenceAgain, ours);
      // `import()` calls run and settle in a compiled test run as they do in the executable: the page says so.
      if (
        (kind === "stdout" || kind === "exit-code") &&
        withoutDetails(ours.stdout.replace(/^bun test v.*\n/, "")) === withoutDetails(asBuilt.stdout)
      )
        kind = "as the executable";
      else if (
        kind === "stdout" &&
        hasFiles &&
        /\bimport\(|\brequire\(/.test(text) &&
        sameLinesInAnotherOrder(ours, referenceAgain)
      )
        kind = "an order of loads";
      // A test run ends with its tests. Whether a file that somebody began to load without waiting for it still runs is a race in `bun test` itself: it answers now one way and now the other.
      else if (
        kind === "stdout" &&
        /(?<!await )(?<!return )\bimport\(/.test(text) &&
        (lacksOnlyLines(ours.stdout, referenceAgain.stdout) || lacksOnlyLines(referenceAgain.stdout, ours.stdout))
      )
        kind = "what nobody waits for at the end of a test run";
      add("test-run-" + kind);
      if (kept.includes(kind)) {
        const summary = firstDifference(ours, referenceAgain);
        keepFind("test-run-" + kind, summary, {
          ["program" + extension]: text,
          "report.txt": `test-run-${kind}: a test imports the program\n${command.join(" ")}\n${summary}`,
          "compiled.stdout": ours.stdout,
          "compiled.stderr": ours.stderr,
          "bun-run.stdout": referenceAgain.stdout,
          "bun-run.stderr": referenceAgain.stderr,
          "executable.stdout": asBuilt.stdout,
        });
      }
    }
  }
  if (counts.taken >= 50) tell();
}
if (counts.taken) tell();
rmSync(folder, { recursive: true, force: true });
