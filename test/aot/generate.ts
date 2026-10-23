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
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { availableParallelism } from "os";
import { dirname, join } from "path";
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
  for (const name of names) {
    const entry = mainAbove(name) ?? name;
    if (entry === name && besidePrograms.test(name)) continue;
    if (!programs.has(entry)) {
      programs.set(entry, { entry, files: {} });
      const bare = entry.replace(/(\/main)?\.[a-z]+$/, "");
      byName.set(bare, [...(byName.get(bare) ?? []), programs.get(entry)!]);
    }
    programs.get(entry)!.files[name] = files[name];
  }
  for (const name of names)
    if (!mainAbove(name) && besidePrograms.test(name))
      for (const program of byName.get(name.replace(besidePrograms, "")) ?? []) program.files[name] = files[name];
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
  const typed = (name: string) =>
    written[`${name}.ts`] ?? readFileSync(join(import.meta.dir, "programs", topic, `${name}.ts`), "utf8");
  return Object.fromEntries(names.map(name => [`${name}-untyped.${extension}`, transpiler.transformSync(typed(name))]));
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
  "classes-and-closures": () => require("./generate/classes-and-closures"),
  "classes-below-built-in-classes": () => require("./generate/classes-below-built-in-classes"),
  "closed-world": () => require("./generate/closed-world"),
  "copies-born-in-their-holders": () => require("./programs/generate-copies-born-in-their-holders"),
  "copies-of-heirs": () => require("./generate/copies-of-heirs"),
  "data-from-outside": () => require("./generate/data-from-outside"),
  "effects": () => require("./generate/effects"),
  "escape-analysis": () => require("./generate/escape-analysis"),
  "every-member-of-a-host-object": () => require("./generate/every-member-of-a-host-object"),
  "function-prototypes": () => require("./generate/function-prototypes"),
  "host-classes": () => require("./generate/host-classes"),
  "impostors": () => require("./generate/impostors"),
  "impostors-typed": () => require("./generate/impostors-typed"),
  "inner-objects": () => require("./generate/inner-objects"),
  "kept-attacks": () => require("./generate/kept-attacks"),
  "language": () => require("./generate/language"),
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
    if (existsSync(kept)) cpSync(kept, join(where, each), { recursive: true });
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
