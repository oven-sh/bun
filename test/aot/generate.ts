// Some folders of ./programs are written by a script, whole or in part. What a script writes is not kept in the repository: a test file writes the programs that it runs
// into a temporary folder when it starts (run-programs.ts). This writes them for whoever wants to read them, or to run them with a tool of their own:
//
//   bun test/aot/generate.ts                       names the folders
//   bun test/aot/generate.ts <folder> <where>      writes <where>/<folder> as a test sees it: the programs that the script writes and, beside them, those of ./programs/<folder>, written by hand
//   bun test/aot/generate.ts all <where>           every such folder
//
//   --table <aot_builtin_table.json>               the table of built-ins, for the programs that follow from it. Unless given: `findBuiltinTable` below
//   --jobs <n>                                     how many processes write those programs at a time (default: four per core, 64 at most: they wait for timers most of the time)
//
// The same script, table and Bun write the same bytes every time, however many processes share the work.
//
// A folder of ./programs may also hold files `*.programs`, each with many programs in it: `packedFiles` below. They are written out in the same way.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { availableParallelism, tmpdir } from "os";
import { basename, dirname, join, resolve, sep } from "path";
import type { Row } from "./built-ins-alone/table";

/** A program that a script writes. `entry` and the names of `files` are paths below the folder of programs. */
export type WrittenProgram = { entry: string; files: Record<string, string> };

export type Generator = {
  /** The programs whose text follows from the script alone. All of them are made in a fraction of a second. */
  programs(): WrittenProgram[];
  /**
   * The programs that follow from the table of built-ins. The script calls each built-in to learn what to ask of it, so nobody knows the programs, or their names, before they are made.
   * That takes some milliseconds a program and leaves the process in no state to go on with: it is done in other processes, `writeGroups` below.
   * What is known beforehand is the groups: the rows of the table whose programs are made together, by a name with which the names of those programs begin. No group hangs on another.
   */
  fromTable?: {
    /** Of the files of all these programs. */
    extension: string;
    groups(rows: Row[]): Map<string, Row[]>;
    programs(groups: Map<string, Row[]>): Promise<Map<string, WrittenProgram[]>>;
  };
};

const besidePrograms = /\.(json|expected\.txt|build-errors\.txt|todo\.txt)$/;

/**
 * Files, by their paths below a folder of programs, as programs, by the rules at the top of run-programs.ts: a folder with a main.<extension> is one program,
 * and so is any other source file, with the files that bear its name.
 */
export function programsOf(files: Record<string, string>): WrittenProgram[] {
  const names = Object.keys(files);
  const mainOf = new Map(
    names.filter(name => /\/main\.([cm]?[jt]s|tsx)$/.test(name)).map(main => [dirname(main), main]),
  );
  const mainAbove = (name: string) => {
    const parts = name.split("/");
    for (let depth = 1; depth < parts.length; depth++)
      if (mainOf.has(parts.slice(0, depth).join("/"))) return mainOf.get(parts.slice(0, depth).join("/"))!;
  };
  const programs = new Map<string, WrittenProgram>();
  const byName = new Map<string, WrittenProgram[]>();
  const handOn = (program: WrittenProgram, name: string) =>
    Object.defineProperty(program.files, name, Object.getOwnPropertyDescriptor(files, name)!);
  for (const name of names) {
    const entry = mainAbove(name) ?? name;
    if (entry === name && besidePrograms.test(name)) continue;
    if (!programs.has(entry)) {
      programs.set(entry, { entry, files: {} });
      const bare = entry.replace(/(\/main)?\.[a-z]+$/, "");
      byName.set(bare, [...(byName.get(bare) ?? []), programs.get(entry)!]);
    }
    handOn(programs.get(entry)!, name);
  }
  for (const name of names)
    if (!mainAbove(name) && besidePrograms.test(name))
      for (const program of byName.get(name.replace(besidePrograms, "")) ?? []) handOn(program, name);
  return [...programs.values()];
}

/** A text in which blocks of lines stand again and again with other numbers, or with what a row of a table holds between its tabs. */
export const text = (...pieces: (string | [rows: number | string, block: (n: number, ...row: string[]) => string])[]) =>
  pieces
    .map(piece => {
      if (typeof piece === "string") return piece;
      const rows =
        typeof piece[0] === "number"
          ? Array.from({ length: piece[0] }, () => [])
          : piece[0].split("\n").map(row => row.split("\t"));
      return rows.map((row, n) => piece[1](n, ...row)).join("\n");
    })
    .join("\n");

/** Files that are one text but for a few places. The table has a row for each: its name, then what stands in those places. */
export const family = (rows: string, file: (...row: string[]) => string) =>
  Object.fromEntries(
    rows
      .split("\n")
      .map(row => row.split("\t"))
      .map(([name, ...row]) => [name, file(...row)]),
  );

/** `<name>-untyped.<extension>` for each name: what `<name>.ts` of the folder is without its types. */
export function untypedTwins(
  topic: string,
  extension: "js" | "ts",
  names: string[],
  written: Record<string, string> = {},
): Record<string, string> {
  const transpiler = new Bun.Transpiler({ loader: "ts", target: "bun", deadCodeElimination: false, inline: false });
  const packed = packsOf(topic).length ? packedFiles(topic) : {};
  const kept = (name: string) => join(import.meta.dir, "programs", topic, `${name}.ts`);
  const typed = (name: string) =>
    written[`${name}.ts`] ?? (existsSync(kept(name)) ? readFileSync(kept(name), "utf8") : packed[`${name}.ts`]);
  return Object.fromEntries(names.map(name => [`${name}-untyped.${extension}`, transpiler.transformSync(typed(name))]));
}

const topics = () =>
  readdirSync(join(import.meta.dir, "programs"), { withFileTypes: true }).filter(entry => entry.isDirectory());
const packsOf = (topic: string) =>
  readdirSync(resolve(import.meta.dir, "programs", topic))
    .filter(name => name.endsWith(".programs"))
    .sort();

/**
 * The files that the `*.programs` files of a folder hold, by their paths below the folder. A line that begins with four slashes is a mark:
 *
 *   //// <path>                        a file begins. `////! <path>`: one without a newline at its end
 *   ////: <name>                       a piece begins: text that stands in several places. «1» to «9» in it stand for arguments
 *   ////= <name><tab><argument>..      here stands that piece
 *
 * A piece is known in every such file of its folder. `topic`: a folder of ./programs, or the whole path of any other folder.
 */
export function packedFiles(topic: string): Record<string, string> {
  const pieces = new Map<string, string>();
  const files: Record<string, string> = {};
  const expanded = (body: string, given: string[] = []): string =>
    (given.length ? body.replace(/«(\d)»/g, (_, n) => given[n - 1]) : body).replace(/^\/\/\/\/= ([^\n]*)\n/gm, (_, use) => {
      const [name, ...passed] = use.split("\t");
      return expanded(pieces.get(name)!, passed);
    });
  for (const pack of packsOf(topic)) {
    const text = readFileSync(resolve(import.meta.dir, "programs", topic, pack), "utf8").replaceAll("\r\n", "\n");
    const marks = [...text.matchAll(/^\/\/\/\/([ !:]) ?([^\n]*)\n/gm)];
    for (const [index, { 0: line, 1: mark, 2: name, index: start }] of marks.entries()) {
      const body = () => text.slice(start + line.length, marks[index + 1]?.index);
      if (mark === ":") pieces.set(name, body());
      // A text is put together when somebody reads it: most who ask want the names.
      else
        Object.defineProperty(files, name, {
          enumerable: true,
          get: () => expanded(body()).slice(0, mark === "!" ? -1 : undefined),
        });
    }
  }
  return files;
}

/**
 * For whoever walks ./programs by himself and draws from the programs that are one file: `kept`, what the walk of `root` found, with the packed ones whose names match
 * among them, each where it would lie if it were kept. `textOf` reads either. `stored`: not those beside which a file with one of these endings is kept.
 */
export function withPackedPrograms(root: string, kept: string[], matches: RegExp, stored: string[] = []) {
  const packed = new Map<string, () => string>();
  const programs = join(import.meta.dir, "programs");
  for (const { name: topic } of resolve(root) === programs ? topics() : [])
    for (const { entry, files } of packsOf(topic).length ? programsOf(packedFiles(topic)) : [])
      if (
        Object.keys(files).length === 1 &&
        matches.test(entry) &&
        !basename(entry).startsWith("main.") &&
        !stored.some(suffix => existsSync(join(programs, topic, entry.replace(/\.[a-z]+$/, suffix))))
      )
        packed.set(join(programs, topic, entry), () => files[entry]);
  const parts = new Map([...kept, ...packed.keys()].map(path => [path, path.split(sep)]));
  const inOrderOfWalk = (a: string[], b: string[]) => {
    const differs = a.findIndex((part, index) => part !== b[index]);
    return differs < 0 ? -1 : a[differs] < (b[differs] ?? "") ? -1 : 1;
  };
  return {
    paths: [...parts.keys()].sort((a, b) => inOrderOfWalk(parts.get(a)!, parts.get(b)!)),
    textOf: (path: string) => packed.get(path)?.() ?? readFileSync(path, "utf8"),
  };
}

/** By the folder of ./programs. A script is loaded when somebody asks for its folder. */
export const generators: Record<string, () => Generator> = {
  "arrays": () => require("./generate/arrays"),
  "async-and-generators": () => require("./generate/async-and-generators"),
  "awaited-objects": () => require("./generate/awaited-objects"),
  "built-ins-alone": () => require("./generate-built-ins-alone"),
  "built-ins-asked-in-place": () => require("./generate-built-ins-asked-in-place"),
  "built-ins-on-written-structure": () => require("./programs/generate-replaced-iteration"),
  "builtin-modules": () => require("./generate/builtin-modules"),
  "calls": () => require("./generate/calls"),
  "classes": () => require("./generate/classes"),
  "classes-and-closures": () => ({
    programs: () =>
      ["classes-and-closures", "closures-made-at-the-first-read", "definitions-made-at-the-first-use"].flatMap(
        part => (require(`./generate/${part}`) as Generator).programs(),
      ),
  }),
  "classes-below-built-in-classes": () => require("./generate/classes-below-built-in-classes"),
  "closed-world": () => require("./generate/closed-world"),
  "code-that-built-ins-run": () => require("./generate/code-that-built-ins-run"),
  "copies-born-in-their-holders": () => require("./programs/generate-copies-born-in-their-holders"),
  "copies-of-heirs": () => require("./generate/copies-of-heirs"),
  "data-from-outside": () => require("./generate/data-from-outside"),
  "effects": () => require("./generate/effects"),
  "escape-analysis": () => require("./generate/escape-analysis"),
  "every-member-of-a-host-object": () => require("./generate/every-member-of-a-host-object"),
  "function-prototypes": () => require("./generate/function-prototypes"),
  "host-classes": () => require("./generate/host-classes"),
  "impostors": () => require("./generate/impostors"),
  "impostors-typed": () => ({
    programs: () =>
      ["impostors-typed", "strangers-by-roads-that-are-no-calls"].flatMap(
        part => (require(`./generate/${part}`) as Generator).programs(),
      ),
  }),
  "initializers-run-at-the-first-read": () => require("./generate/initializers-run-at-the-first-read"),
  "inner-objects": () => require("./generate/inner-objects"),
  "json-text-of-records": () => require("./generate/json-text-of-records"),
  "kept-attacks": () => require("./generate/kept-attacks"),
  "language": () => ({
    programs: () =>
      ["language", "planned-ahead-of-loops"].flatMap(
        part => (require(`./generate/${part}`) as Generator).programs(),
      ),
  }),
  "method-table": () => require("./generate/method-table"),
  "modules": () => require("./generate/modules"),
  "native-callbacks": () => ({
    programs: () =>
      [
        "one-for-each-caller",
        "one-for-each-caller-2",
        "one-for-each-caller-3",
        "one-for-each-caller-4",
        "models",
        "array-likes",
        "members",
      ].flatMap(part => (require(`./generate/native-callbacks-${part}`) as Generator).programs()),
  }),
  "nothing-throws-because-of-a-type": () => require("./programs/generate-nothing-throws-because-of-a-type"),
  "objects": () => require("./generate/objects"),
  "objects-that-are-not-what-their-layout-says": () =>
    require("./generate/objects-that-are-not-what-their-layout-says"),
  "private-class-members": () => require("./generate/private-class-members"),
  "relations-at-random": () => require("./generate-relations-at-random"),
  "site-records": () => require("./generate/site-records"),
  "soundness": () => require("./generate/soundness"),
  "strings": () => require("./generate/strings"),
  "structural-types": () => require("./generate/structural-types"),
  "type-predicates": () => require("./programs/generate-type-predicates"),
  "type-rules": () => require("./generate/type-rules"),
  "typed-objects": () => require("./generate/typed-objects"),
  "untyped-code": () => require("./generate/untyped-code"),
  "untyped-loops": () => require("./generate/untyped-loops"),
  "untyped-stress": () => require("./generate/untyped-stress"),
  "ways-into-library-modules": () => require("./generate/ways-into-library-modules"),
  "writes-to-host-objects": () => require("./generate/writes-to-host-objects"),
};

for (const { name: topic } of topics()) {
  if (packsOf(topic).length === 0) continue;
  const script = generators[topic];
  generators[topic] = () => {
    const generator: Generator | undefined = script?.();
    // What is packed under the name of a program that the script writes takes its place, as what is kept does.
    const programs = () => {
      const packed = programsOf(packedFiles(topic));
      const entries = new Set(packed.map(program => program.entry));
      return [...(generator?.programs() ?? []).filter(program => !entries.has(program.entry)), ...packed];
    };
    return { ...generator, programs };
  };
}

/**
 * The table of built-ins that `bun` was built with, as the build wrote it: $AOT_BUILTIN_TABLE, or aot_builtin_table.json beside that Bun (CI packs it there),
 * or in the folder `codegen` beside it, where it lies in a build folder.
 */
export function findBuiltinTable(bun: string): string | undefined {
  const name = "aot_builtin_table.json";
  return (
    process.env.AOT_BUILTIN_TABLE ?? [join(dirname(bun), name), join(dirname(bun), "codegen", name)].find(existsSync)
  );
}

export function writeProgram(folder: string, program: WrittenProgram) {
  for (const [name, text] of Object.entries(program.files)) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), text);
  }
}

/**
 * For a test whose many small files lie in `*.programs` files: a temporary folder with all that `folder` holds, written out. It is gone when the process ends.
 * A tsconfig.json at the top of `folder` is inherited from: what it names by a path stays where it is.
 */
export function unpacked(folder: string): string {
  const where = realpathSync(mkdtempSync(join(tmpdir(), `${basename(folder)}-`)));
  process.on("exit", () => rmSync(where, { recursive: true, force: true }));
  cpSync(folder, where, { recursive: true, filter: source => !source.endsWith(".programs") });
  if (existsSync(join(folder, "tsconfig.json")))
    writeFileSync(join(where, "tsconfig.json"), JSON.stringify({ extends: join(folder, "tsconfig.json") }));
  writeProgram(where, { entry: "", files: packedFiles(folder) });
  return where;
}

/** Writes the programs of these groups into <where>/<topic>, in `jobs` processes at a time. Answers the entry points of each group. */
export function writeGroups(
  bun: string,
  topic: string,
  groups: Map<string, Row[]>,
  where: string,
  jobs: number,
  env?: Record<string, string | undefined>,
): Map<string, string[]> {
  const entries = new Map<string, string[]>();
  if (groups.size === 0) return entries;
  const work = join(where, `.${topic}.${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    writeFileSync(join(work, "groups.json"), JSON.stringify([...groups]));
    const cmd = [bun, import.meta.path, "--write-groups", topic, where, work, String(jobs)];
    const { stderr, exitCode, signalCode } = Bun.spawnSync({
      cmd,
      env,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    if (exitCode !== 0)
      throw new Error(
        `the programs of ${topic} could not be written: ${cmd.join(" ")} ended with ${exitCode ?? signalCode}\n${stderr.toString().split("\n").slice(-30).join("\n")}`,
      );
    const written = new Map<string, string[]>(JSON.parse(readFileSync(join(work, "written.json"), "utf8")));
    // A group may come to nothing: no call of its built-ins with sample operands succeeds.
    for (const group of groups.keys()) entries.set(group, written.get(group) ?? []);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return entries;
}

// bun generate.ts --write-groups <topic> <where> <work> <jobs>: reads <work>/groups.json and writes <work>/written.json. With more than one job it deals the groups out to processes like itself.
async function writeGroupsHere(topic: string, where: string, work: string, jobs: number) {
  const groups: [string, Row[]][] = JSON.parse(readFileSync(join(work, "groups.json"), "utf8"));
  // Four to eight groups a process: its start is paid for, and no group waits long behind a slow one.
  const shares = Math.min(Math.ceil(groups.length / 4), Math.max(jobs, Math.ceil(groups.length / 8)));
  if (jobs === 1 || shares === 1) {
    // What is called here rejects promises that nobody holds and throws from timers.
    process.on("unhandledRejection", () => {});
    process.on("uncaughtException", () => {});
    const written: [string, string[]][] = [];
    for (const [group, programs] of await generators[topic]().fromTable!.programs(new Map(groups))) {
      for (const program of programs) writeProgram(join(where, topic), program);
      written.push([group, programs.map(program => program.entry)]);
    }
    writeFileSync(join(work, "written.json"), JSON.stringify(written));
    // A timer or a listener that was made on the way would keep the process alive.
    process.exit(0);
  }
  // Each group goes to the share that has the least to do so far, the largest groups first. Within a share they keep their order.
  const weights = groups.map(([, rows]) => rows.reduce((sum, row) => sum + row.trusted.length, 1));
  const members: number[][] = Array.from({ length: shares }, () => []);
  const loads: number[] = new Array(shares).fill(0);
  for (const index of weights.map((_, index) => index).sort((a, b) => weights[b] - weights[a] || a - b)) {
    const least = loads.indexOf(Math.min(...loads));
    loads[least] += weights[index];
    members[least].push(index);
  }
  const groupsOf = (share: number) => members[share].sort((a, b) => a - b).map(index => groups[index]);
  const written: [string, string[]][][] = [];
  let next = 0;
  const worker = async () => {
    while (next < shares) {
      const share = next++;
      const folder = join(work, String(share));
      mkdirSync(folder);
      writeFileSync(join(folder, "groups.json"), JSON.stringify(groupsOf(share)));
      const child = Bun.spawn({
        cmd: [process.execPath, import.meta.path, "--write-groups", topic, where, folder, "1"],
        stdin: "ignore",
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
      if (exitCode !== 0) {
        const names = groupsOf(share).map(([group]) => group);
        throw new Error(
          `the process that wrote ${names.join(" ")} ended with ${exitCode ?? child.signalCode}\n${stderr.split("\n").slice(-20).join("\n")}`,
        );
      }
      written[share] = JSON.parse(readFileSync(join(folder, "written.json"), "utf8"));
    }
  };
  await Promise.all(Array.from({ length: jobs }, worker));
  writeFileSync(join(work, "written.json"), JSON.stringify(written.flat()));
}

if (import.meta.main && process.argv[2] === "--write-groups") {
  const [topic, where, work, jobs] = process.argv.slice(3);
  await writeGroupsHere(topic, where, work, Number(jobs));
} else if (import.meta.main) {
  const flags = ["--table", "--jobs"];
  const option = (name: string): string | undefined =>
    process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined;
  const [topic, where] = process.argv
    .slice(2)
    .filter((argument, index, all) => !flags.includes(argument) && !flags.includes(all[index - 1]));
  const topics = topic === "all" ? Object.keys(generators) : [topic];
  if (where === undefined || topics.some(each => !(each in generators))) {
    console.log(
      `bun test/aot/generate.ts <folder> <where>\n\nThe folders: ${Object.keys(generators).join(" ")}, or all`,
    );
    process.exit(topic === undefined ? 0 : 1);
  }
  const tablePath = option("--table") ?? findBuiltinTable(process.execPath);
  let rows: Row[] | undefined;

  mkdirSync(where, { recursive: true });
  if (!existsSync(join(where, "tsconfig.json")))
    writeFileSync(
      join(where, "tsconfig.json"),
      JSON.stringify({ extends: join(import.meta.dir, "programs", "tsconfig.json") }) + "\n",
    );
  for (const each of topics) {
    const generator = generators[each]();
    const kept = join(import.meta.dir, "programs", each);
    // What is kept under the name of a program that the script writes takes its place.
    const programs = generator.programs().filter(program => !existsSync(join(kept, program.entry)));
    for (const program of programs) writeProgram(join(where, each), program);
    if (existsSync(kept))
      cpSync(kept, join(where, each), { recursive: true, filter: source => !source.endsWith(".programs") });
    const entries = programs.map(program => program.entry);
    if (generator.fromTable && (tablePath === undefined || !existsSync(tablePath))) {
      console.error(
        `${each}: the programs that follow from the table of built-ins are not written: there is no aot_builtin_table.json in $AOT_BUILTIN_TABLE, beside ${process.execPath} or in the folder codegen beside it. --table <file> names it`,
      );
      process.exitCode = 1;
    } else if (generator.fromTable) {
      const { describedRows, readTable } = require("./built-ins-alone/table");
      rows ??= describedRows(readTable(tablePath)) as Row[];
      const jobs = Number(option("--jobs")) || Math.min(4 * availableParallelism(), 64);
      entries.push(
        ...[...writeGroups(process.execPath, each, generator.fromTable.groups(rows), where, jobs).values()].flat(),
      );
    }
    const seen = new Set<string>();
    const twice = entries.filter(entry => seen.size === seen.add(entry).size);
    if (twice.length > 0) throw new Error(`${each}: more than one program is named ${twice.join(", ")}`);
    console.log(`${each}: the script wrote ${entries.length} programs`);
  }
}
