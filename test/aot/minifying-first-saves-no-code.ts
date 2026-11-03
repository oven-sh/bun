// Minifying first saves no code. Whatever `bun build --minify-syntax` makes of a program before it prints it (a constant put where its name stood, an
// expression of constants computed, a branch that is never taken dropped, an enum member replaced by its value) the compiler makes of the program as it is
// written. So `--aot` on the sources gives no more code than `--aot` on what the bundler printed.
//
// A case is a folder of files. Nothing that is expected is written down: the Bun under test makes the minified forms on the spot.
//
//   written     the files of the case
//   each file   every file through `bun build --no-bundle --minify-syntax`, under its own name with the extension of JavaScript
//   bundled     the entry point through `bun build --minify-syntax --target=bun`: one file
//
// Each form is built with `--aot`, and the image of the written form is held against the images of the other two:
//
//   code bytes            of every function in the image, what it holds of Bun's library among them
//   operations            the operations of the IR that code was generated for
//   run-time operations   the calls out of compiled code into the run time while the program runs (not on Windows, where they are not counted)
//
// None of the three is larger as written. And all three executables print what `bun run` prints for the files as written.
//
// The IR of a program is the same for every target. The first two numbers are read behind the back end, from the map of the image, so they are the target's: an operation counts
// if an instruction is its own. x64 stores a constant with one instruction, which is the store's, and arm64 loads it into a register first, which is the constant's, unless a number
// of the image with the same value is in a register already. So a constant that is one machine word is no operation here: its bytes count. What is allowed in bytes stands by target
// in `bytesOnThisTarget`, and nothing else here knows the target.
//
// In every form a file of one line imports the entry point and starts the program. A program of several files has a function that runs them in their order, and a program of one file
// has none: so every form has that function, and it is not what is compared. Nor is the call of each further file that has something to run.
//
// The cases of a group are the entry points of one executable, behind ./minifying-first-saves-no-code/run-in-a-worker.mjs. An entry point begins a program
// of its own, so each case is compiled as it is alone, and an executable is written once for all of them. Not quite alone: files that are scripts share their globals, and what is
// counted in a run can move by one with the neighbors. So a case that is larger beside the others is asked again in executables of its own, and that answer counts.
//
// Where the minifier removes an error that the language demands, there is code that minifying first saves: the code that throws. Such a case names the error
// (`errorThatTheMinifierRemoves`), and both halves are asked in place of the sizes: the executable of the files as written throws it, and those of the minified forms do not.
//
// The cases that are larger as written today stand in ./minifying-first-saves-no-code/known-today.ts with their numbers and are todo. They share executables with each other
// alone, which only a run with --todo builds.
//
//   AOT_MINIFYING_FIRST=<text>    only the cases whose name contains the text
//   AOT_REDS=<file>               gets a line for each case that is larger as written: its name, a tab, what the bundler saves
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { buildEnvironment, compileCommand, runtimeEnvironment } from "./harness/flags";
import { slot, spawned, withoutDebugInformation } from "./harness/commands";
import { describe, test } from "./supported";

export type Case = {
  files: Record<string, string>;
  /** The file that starts the program. Without it: the first of `files`. */
  entry?: string;
  /** `--define`, for the minifier and for every build. */
  define?: Record<string, string>;
  /** More flags, for the minifier and for every build. */
  flags?: string[];
  /** false: the code alone is compared. The case is the input of a test that only reads what the bundler prints, and names things that are nowhere. */
  runs?: boolean;
  /** The executable of the files as written throws it, `bun run` and the executables of the minified forms do not. The sizes are not compared. */
  errorThatTheMinifierRemoves?: string;
};

const minifiedForms = ["each file", "bundled"] as const;
const forms = ["written", ...minifiedForms] as const;
type Form = (typeof forms)[number];

export type Measured = {
  codeBytes: number;
  operations: number;
  /** The files whose own code has an operation. */
  filesThatRun: number;
  pathsThatRun: string[];
  runtimeOperations: number | undefined;
  byOperation: Record<string, number>;
};
type Outcome = { failure: string } | (Measured & { output: string | undefined });

const casesInOneExecutable = 48;
const countedRunsAtOnce = 4;
const runner = "run-in-a-worker.mjs";
const starter = "start-the-case.mjs";
// otherNumbers: the n-th text of a program is named by the number n, and on x64 the instruction for 0 is three bytes shorter than that for 1, and an offset takes one byte or four. On
// arm64 a number takes one instruction or two.
// callOfAFile: the call, and what the function that is called has around its operations: on x64 a return; on arm64 also a frame record that is pushed and popped, and the addresses that one function loads once and each of two loads for itself.
const bytesOnThisTarget = { x64: { otherNumbers: 16, callOfAFile: 8 }, arm64: { otherNumbers: 16, callOfAFile: 32 } }[
  process.arch as "x64" | "arm64"
];
// An ASAN build emits four times the bytes for the same functions.
const mostCodeBytesForOtherNumbers = bytesOnThisTarget.otherNumbers * (isASAN ? 4 : 1);
// The files of a program stay files: each that has something to run is a function, and the function that runs them in their order calls it. The bundler has one file.
const callOfAFile = { operations: 1, codeBytes: bytesOnThisTarget.callOfAFile * (isASAN ? 4 : 1) };
// A debug or ASAN build of Bun is many times slower.
const oneExecutableIn = (isASAN || isDebug) && !process.env.AOT_MINIFYING_FIRST ? 8 : 1;
const constantsOfOneWord = new Set(["Undefined", "Null", "Absent", "Boolean", "Integer", "Double"]);
const mark = "=== the program above has ended with";
const isCode = (path: string) => /\.([cm]?[jt]s|[jt]sx)$/.test(path) && !/\.d\.[cm]?ts$/.test(path);
const asJavaScript = (path: string) => path.replace(/\.([cm]?)tsx?$/, ".$1js").replace(/\.jsx$/, ".js");
const folderOf = (index: number) => "c" + String(index).padStart(3, "0");
const entryOf = (it: Case) => it.entry ?? Object.keys(it.files)[0];
const flagsOf = (it: Case) => [
  ...Object.entries(it.define ?? {}).map(([name, value]) => `--define=${name}=${value}`),
  ...(it.flags ?? []),
];

const besideEveryCase = {
  "globals.d.ts": `declare const console: { log(...values: unknown[]): void };\ndeclare const process: { argv: string[]; env: Record<string, string | undefined>; platform: string; arch: string };\n`,
  "tsconfig.json": JSON.stringify({
    // Without it every file of every case is in the program of each.
    include: ["globals.d.ts"],
    compilerOptions: {
      lib: ["ESNext"],
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      allowJs: true,
      checkJs: false,
      noEmit: true,
      strict: true,
      resolveJsonModule: true,
      experimentalDecorators: true,
      jsx: "react-jsx",
      types: [],
    },
  }),
};

function write(folder: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
}

const firstLines = (text: string) => text.trim().split("\n").filter(line => line.trim() && !line.startsWith("Args: ")).slice(0, 6).join(" | ").slice(0, 600); // prettier-ignore

/** Writes the form of a case below `folder`. Answers what went wrong where the bundler does not print the case. */
async function writeForm(form: Form, it: Case, written: string, folder: string): Promise<string | undefined> {
  write(folder, { [starter]: `import "./${form === "written" ? entryOf(it) : asJavaScript(entryOf(it))}";\n` });
  if (form === "written") return void write(folder, it.files);
  if (form === "bundled") {
    const outfile = join(folder, asJavaScript(entryOf(it)));
    const bundle = await spawned([bunExe(), "build", "--minify-syntax", "--target=bun", ...flagsOf(it), "./" + entryOf(it), "--outfile", outfile], written, bunEnv); // prettier-ignore
    return bundle.exitCode === 0 && existsSync(outfile) ? undefined : "the bundler: " + firstLines(bundle.stderr);
  }
  for (const [path, text] of Object.entries(it.files)) {
    if (!isCode(path)) {
      write(folder, { [path]: text });
      continue;
    }
    const printed = await spawned([bunExe(), "build", "--no-bundle", "--minify-syntax", "--target=bun", ...flagsOf(it), "./" + path], written, bunEnv); // prettier-ignore
    if (printed.exitCode !== 0) return "the bundler: " + firstLines(printed.stderr);
    write(folder, { [asJavaScript(path)]: printed.stdout });
  }
}

/**
 * What the map of an image says of its functions. Row `F` (a function): its number, offset, size, .., what it is (8), .., its file (10), ... Row `A` (a function that shares the code
 * of another): the same without the number. The row `S` behind a function has five columns for each instruction: the operation it was generated for, the number of that operation, where
 * it was inlined from, offset, size.
 */
function readMap(path: string): Omit<Measured, "runtimeOperations"> {
  let codeBytes = 0;
  const byOperation: Record<string, number> = {};
  let operations = 0;
  const files: { path: string; offset: string }[] = [];
  const offsetsOfCodeWithOperations = new Set<string>();
  let offset = "";
  for (const line of readFileSync(path, "latin1").split("\n")) {
    const fields = line.split("\t");
    if (fields[0] === "F") {
      codeBytes += Number(fields[3]);
      offset = fields[2];
      if (fields[8] === "module") files.push({ path: fields[10], offset });
    } else if (fields[0] === "A") {
      codeBytes += Number(fields[2]);
      if (fields[7] === "module") files.push({ path: fields[9], offset: fields[1] });
    } else if (fields[0] === "S") {
      const seen = new Set<string>();
      for (let at = 1; at + 4 < fields.length + 1; at += 5) {
        if (fields[at] === "-" || fields[at] === undefined) continue;
        const key = fields.slice(at, at + 3).join(" ");
        const name = fields[at].replace(/[./].*$/, "");
        if (seen.has(key) || constantsOfOneWord.has(name.replace(/[+*]+$/, ""))) continue;
        seen.add(key);
        operations++;
        byOperation[name] = (byOperation[name] ?? 0) + 1;
      }
      if (seen.size) offsetsOfCodeWithOperations.add(offset);
    }
  }
  const pathsThatRun = [...new Set(files.filter(file => offsetsOfCodeWithOperations.has(file.offset)).map(file => file.path))]; // prettier-ignore
  return { codeBytes, operations, filesThatRun: pathsThatRun.length, pathsThatRun, byOperation };
}

function runtimeOperationsIn(path: string) {
  let calls = 0;
  for (const line of readFileSync(path, "utf8").split("\n"))
    if (line.includes("\toperation:")) calls += Number(line.split("\t")[0]);
  return calls;
}

async function run(
  cmd: string[],
  folder: string,
  programs: string[],
  more: Record<string, string> = {},
  list = "tasks.json",
) {
  const tasks = join(folder, list);
  writeFileSync(tasks, JSON.stringify(programs));
  const ran = await spawned(cmd, folder, { ...bunEnv, ...more, AOT_TASKS: tasks, AOT_MARK: mark });
  const parts = ran.stdout.split(new RegExp(`\\n${mark} (\\S+)\\n`));
  return programs.map((_, index) => (parts[2 * index + 1] === undefined ? `the process ended: ${ran.signal ?? ran.exitCode} ${firstLines(ran.stderr)}` : `${parts[2 * index]}\nexit ${parts[2 * index + 1]}`)); // prettier-ignore
}

/**
 * Builds one form of the cases into one executable and measures each. A case that the compiler refuses is left out, and the others are built again. Where nothing says which case
 * stops a build, each half of the cases gets an executable of its own.
 */
async function measureForm(
  form: Form,
  cases: Case[],
  root: string,
  failures: (string | undefined)[],
): Promise<Outcome[]> {
  const folder = join(root, form.replace(" ", "-"));
  const entryIn = (index: number) => `./${folderOf(index)}/${starter}`;
  const flags = [...new Set(cases.flatMap(flagsOf))];
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const map = join(folder, "program.map");
  const build = async (entryPoints: number[]) => {
    for (const name of readdirSync(folder)) if (name.startsWith("program.map")) rmSync(join(folder, name));
    const built = await spawned(
      [
        bunExe(),
        ...compileCommand,
        ...withoutDebugInformation(),
        "--root",
        ".",
        ...flags,
        "./" + runner,
        ...entryPoints.map(entryIn),
        "--outfile",
        executable,
      ],
      folder,
      { ...bunEnv, [buildEnvironment.mapFilePath]: map },
      600_000,
    );
    // An entry point that loads a file by a name that the build does not know may load any of the others: the build has one program then, and one map.
    if (built.exitCode === 0 && !existsSync(`${map}.${entryPoints.length}`))
      return {
        exitCode: 1,
        stderr: "it may load any file of the executable, so nothing beside it is compiled as it is alone",
      };
    return built;
  };
  const measured = new Map<number, Measured & { output: string | undefined }>();
  const measureExecutable = async (taken: number[]) => {
    // The runner's image has the first map.
    const maps = taken.map((_, at) => readMap(`${map}.${at + 1}`));
    const running = taken.filter(index => cases[index].runs !== false);
    const printed = running.length
      ? await run([executable], folder, running.map(entryIn), { [runtimeEnvironment.forbidsInterpreter]: "1" })
      : [];
    const calls = new Map<number, number>();
    const waiting = isWindows ? [] : [...running];
    await Promise.all(
      Array.from({ length: countedRunsAtOnce }, async () => {
        for (let index = waiting.shift(); index !== undefined; index = waiting.shift()) {
          const counts = join(folder, folderOf(index) + ".counts");
          await run(
            [executable],
            folder,
            [entryIn(index)],
            { BUN_DESTRUCT_VM_ON_EXIT: "1", [runtimeEnvironment.countsPath]: counts },
            folderOf(index) + ".json",
          );
          if (existsSync(counts)) calls.set(index, runtimeOperationsIn(counts));
        }
      }),
    );
    for (const [at, index] of taken.entries())
      measured.set(index, {
        ...maps[at],
        runtimeOperations: calls.get(index),
        output: running.includes(index) ? printed[running.indexOf(index)] : undefined,
      });
  };
  const measureTogether = async (among: number[]): Promise<void> => {
    if (!among.length) return;
    const built = await build(among);
    if (built.exitCode === 0) return measureExecutable(among);
    const lines = built.stderr.split("\n");
    const named = new Map<number, string>();
    for (const [at, line] of lines.entries()) {
      const index = /^\s+at .*\bc(\d{3})[\\/]/.exec(line)?.[1];
      if (index !== undefined && among.includes(Number(index)) && !named.has(Number(index)))
        named.set(Number(index), lines.slice(0, at).findLast(each => each.startsWith("error")) ?? line);
    }
    if (among.length === 1) named.set(among[0], built.stderr);
    for (const [index, stderr] of named) failures[index] = "the build: " + firstLines(stderr);
    if (named.size) return measureTogether(among.filter(index => !named.has(index)));
    await measureTogether(among.slice(0, among.length >> 1));
    await measureTogether(among.slice(among.length >> 1));
  };
  await measureTogether(cases.map((_, index) => index).filter(index => failures[index] === undefined));
  return cases.map((_, index) => measured.get(index) ?? { failure: failures[index]! });
}

type Compared = { plain: string | undefined } & Record<Form, Outcome>;

async function measureGroup(cases: Case[]): Promise<Compared[]> {
  using dir = tempDir("aot-minifying-first", {});
  const root = String(dir);
  const failures = Object.fromEntries(
    forms.map(form => [form, cases.map(() => undefined as string | undefined)]),
  ) as Record<Form, (string | undefined)[]>;
  for (const form of forms) {
    const folder = join(root, form.replace(" ", "-"));
    write(folder, besideEveryCase);
    copyFileSync(join(import.meta.dir, "minifying-first-saves-no-code", runner), join(folder, runner));
    await Promise.all(
      cases.map((it, index) =>
        slot(async () => {
          failures[form][index] = await writeForm(
            form,
            it,
            join(root, "written", folderOf(index)),
            join(folder, folderOf(index)),
          );
        }),
      ),
    );
  }
  const running = cases.map((_, index) => index).filter(index => cases[index].runs !== false);
  const [plain, ...measured] = await Promise.all([
    slot(() => run(
        [bunExe(), "run", ...new Set(cases.flatMap(flagsOf)), "./" + runner], join(root, "written"), running.map(index => `./${folderOf(index)}/${starter}`))), // prettier-ignore
    ...forms.map(form => slot(() => measureForm(form, cases, root, failures[form]))),
  ]);
  return cases.map((_, index) => ({
    plain: running.includes(index) ? plain[running.indexOf(index)] : undefined,
    ...(Object.fromEntries(forms.map((form, at) => [form, measured[at][index]])) as Record<Form, Outcome>),
  }));
}

const moved = (what: string, from: number, to: number) => `${what} ${from} -> ${to}`;

/** What the bundler saves: nothing, if all is well. Each line says by which form, and from how much as written to how much. */
export function savedByMinifyingFirst({ plain, written, ...minified }: Compared) {
  if ("failure" in written) return ["written: " + written.failure];
  const found: string[] = [];
  if (written.output !== plain)
    found.push(`written prints ${JSON.stringify(written.output)}, bun run ${JSON.stringify(plain)}`);
  for (const form of minifiedForms) {
    const other = minified[form];
    if ("failure" in other) {
      found.push(`${form}: ${other.failure}`);
      continue;
    }
    if (other.output !== plain)
      found.push(`${form} prints ${JSON.stringify(other.output)}, bun run ${JSON.stringify(plain)}`);
    const lines: string[] = [];
    const calls = form === "bundled" ? Math.max(0, written.filesThatRun - other.filesThatRun) : 0;
    if (written.codeBytes > other.codeBytes + mostCodeBytesForOtherNumbers + calls * callOfAFile.codeBytes)
      lines.push(moved("code bytes", written.codeBytes, other.codeBytes));
    if (written.operations > other.operations + calls * callOfAFile.operations)
      lines.push(moved("operations", written.operations, other.operations));
    if ((written.runtimeOperations ?? 0) > (other.runtimeOperations ?? 0)) lines.push(moved("run-time operations", written.runtimeOperations!, other.runtimeOperations!)); // prettier-ignore
    if (!lines.length) continue;
    for (const name of Object.keys(written.byOperation).sort())
      if (written.byOperation[name] > (other.byOperation[name] ?? 0))
        lines.push(moved(name, written.byOperation[name], other.byOperation[name] ?? 0));
    if (written.filesThatRun > 4)
      lines.push(`${moved("files that run", written.filesThatRun, other.filesThatRun)}: ${written.pathsThatRun.join(" ").slice(0, 800)}`); // prettier-ignore
    found.push(`${form}: ${lines.join(", ")}`);
  }
  return found;
}

/** Nothing, if the files as written throw the error and nothing else does. */
export function whoThrowsOtherwise(error: string, { plain, written, ...minified }: Compared) {
  if ("failure" in written) return ["written: " + written.failure];
  const found: string[] = [];
  if (!written.output?.includes(error)) found.push(`written prints ${JSON.stringify(written.output)}, without ${error}`);
  if (plain?.includes(error)) found.push(`bun run prints ${JSON.stringify(plain)}`);
  for (const form of minifiedForms) {
    const other = minified[form];
    if ("failure" in other) found.push(`${form}: ${other.failure}`);
    else if (other.output !== plain) found.push(`${form} prints ${JSON.stringify(other.output)}, bun run ${JSON.stringify(plain)}`); // prettier-ignore
  }
  return found;
}

const only = process.env.AOT_MINIFYING_FIRST;

/** Part `part` of `parts`, from 1: the executables are dealt out in turn. */
export function minifyingFirstSavesNoCode(
  title: string,
  cases: Record<string, Case>,
  knownToday: Record<string, string>,
  part = 1,
  parts = 1,
) {
  const names = Object.keys(cases).filter(name => !only || name.includes(only));
  // A case with flags of its own is built beside cases with the same flags: the flags of a build hold for all its entry points. And a case that is known today is built beside
  // others that are: many of them stop a build, and only a run with --todo asks them.
  const groups = [false, true].flatMap(isKnown =>
    [
      ...Map.groupBy(
        names.filter(name => name in knownToday === isKnown),
        name => flagsOf(cases[name]).join(" "),
      ).values(),
    ]
      .flatMap(alike =>
        Array.from({ length: Math.ceil(alike.length / casesInOneExecutable) }, (_, index) =>
          alike.slice(index * casesInOneExecutable, (index + 1) * casesInOneExecutable),
        ),
      )
      .filter((_, index) => index % parts === part - 1 && Math.floor(index / parts) % oneExecutableIn === 0),
  );
  describe.concurrent(title, () => {
    for (const group of groups) {
      let measured: Promise<Compared[]> | undefined;
      for (const [index, name] of group.entries()) {
        const isKnown = name in knownToday;
        (isKnown ? test.todo : test)(
          isKnown ? `${name} (${knownToday[name]})` : name,
          async () => {
            measured ??= measureGroup(group.map(each => cases[each]));
            const error = cases[name].errorThatTheMinifierRemoves;
            const judge = (compared: Compared) =>
              error === undefined ? savedByMinifyingFirst(compared) : whoThrowsOtherwise(error, compared);
            let saved = judge((await measured)[index]);
            if (saved.length && group.length > 1) saved = judge((await measureGroup([cases[name]]))[0]);
            if (saved.length && process.env.AOT_REDS)
              appendFileSync(process.env.AOT_REDS, `${name}\t${saved.join("; ")}\n`);
            expect(saved).toEqual([]);
          },
          1_200_000,
        );
      }
    }
  });
}
