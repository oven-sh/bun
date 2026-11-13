// Programs that were once compiled wrongly, each held to what it must print. Every .txt file of ./fixed holds some, and no formatter rewrites them.
// A line that begins with "#### " begins a part:
//   #### name.js, #### name/lib/a.js   a file. The first file of a name is where the program starts
//   #### name prints                   what it writes to stdout, which is what `bun run` writes. It ends with exit code 0 and writes nothing to stderr
//   #### name prints, exit code 1: TypeError: no   where it ends so. Behind the colon: the line of stderr that names the error, where there is one
//   #### name flags --aot-erase-types  more flags for its build
//   #### name counts                   lines such as `ImageFunctionsEmitted >= 1`, with = or >= or <=: what --explain=statistics says of its build
//   #### name alone                    says nothing
// Each program is the one entry point of a build of its own, so none hides the fault of another, and a build that fails takes no other program along.
// To see a new one fail: <a Bun that has the fault> test test/aot/fixed.test.ts -t "<name>"
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { built, slot, spawned, told, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { describe, test } from "./supported";

type Program = {
  files: Record<string, string>;
  prints?: { stdout: string; stderr: string; exitCode: number };
  flags?: string[];
  counts?: string[];
};

function read(text: string) {
  const programs = new Map<string, Program>();
  for (const part of text
    .replaceAll("\r\n", "\n")
    .split(/^#### /m)
    .slice(1)) {
    const end = part.indexOf("\n");
    const head = part.slice(0, end);
    const body = part.slice(end + 1);
    const [, path, kind, rest] = /^(\S+)(?: (prints|flags|counts|alone)(?:,? (.+))?)?$/.exec(head) ?? [];
    if (!path) throw new Error(`"#### ${head}" begins no part`);
    const name = path.split("/")[0];
    if (!programs.has(name)) programs.set(name, { files: {} });
    const program = programs.get(name)!;
    // The second of two parts with one head would take the place of the first: of two programs with one name, one would never run.
    const once = <Part>(stated: Part | undefined, part: Part) => {
      if (stated !== undefined) throw new Error(`"#### ${head}" is stated twice`);
      return part;
    };
    if (!kind) program.files[path] = once(program.files[path], body);
    else if (kind === "prints") {
      const ends = /^exit code (\d+)(?:: (.+))?$/.exec(rest ?? "exit code 0");
      if (!ends) throw new Error(`"#### ${head}" does not say how the program ends`);
      program.prints = once(program.prints, { stdout: body, stderr: ends[2] ?? "", exitCode: Number(ends[1]) });
    } else if (kind === "flags") program.flags = once(program.flags, rest?.split(" ") ?? []);
    else if (kind === "counts") program.counts = once(program.counts, body.split("\n").filter(Boolean));
  }
  for (const [name, { files, prints }] of programs) {
    if (Object.keys(files).length === 0) throw new Error(`"${name}" has no file`);
    if (!prints) throw new Error(`"${name}" does not say what it prints`);
  }
  return programs;
}

// AOT_PROGRAMS_ALONE=1 around a run asks each build for its program alone (harness/program-alone.ts). A build that is given a copy of Bun to make
// an executable of writes an executable all the same, so then it is given none.
const forAnExecutable = bunEnv.BUN_AOT_WRITES_PROGRAM_ALONE ? [] : withoutDebugInformation();

const folderOfPrograms = join(import.meta.dir, "fixed");
// The folders are removed when the file is done, not behind each `describe`: a hook between two of them ends the group of cases that run beside one
// another, and then the one program of a small .txt file runs with nothing beside it. A folder that cannot be removed keeps no other from it.
const folders = new DisposableStack();
afterAll(() => folders.dispose());

for (const file of readdirSync(folderOfPrograms).sort()) {
  if (!file.endsWith(".txt")) continue;
  const programs = read(readFileSync(join(folderOfPrograms, file), "utf8"));
  const names = [...programs.keys()];
  const filesOfAll = Object.assign({}, ...[...programs.values()].map(({ files }) => files));
  const folder = String(folders.use(tempDirWithBunTypes("fixed", filesOfAll)));
  describe(file.slice(0, -".txt".length), () => {
    test.concurrent.each(names)(
      "%s",
      // A build and a run each end at the time limit of `spawned`: a child that hangs fails its case with what it wrote, and gives the slot back.
      name =>
        slot(async () => {
          const { files, prints, flags = [], counts = [] } = programs.get(name)!;
          const entry = "./" + Object.keys(files)[0];
          const outfile = `${basename(entry).replace(/\.\w+$/, "")}-${names.indexOf(name)}`;
          const statistics = counts.length ? ["--explain=statistics"] : [];
          const words = ["--aot", "--root=.", ...flags, ...statistics, ...forAnExecutable, entry, "--outfile", outfile];
          const build = await spawned([bunExe(), "build", "--compile", ...words], folder, bunEnv);
          try {
            built(build);
            const ran = await spawned([join(folder, outfile)], folder, bunEnv);
            const held = { stdout: ran.stdout, stderr: told(ran).stderr, exitCode: ran.exitCode, signal: ran.signal };
            // Below an error that nobody caught stand frames with the paths of the executable: there `told` keeps the line that names the error.
            // All of stderr stands on both sides, so that a case that fails shows it.
            const all = ran.exitCode === 0 ? {} : { allOfStderr: ran.stderr };
            expect({ ...held, ...all }).toEqual({ ...prints!, signal: null, ...all });
          } finally {
            // An executable is the size of Bun, and nothing but this case starts what its build wrote.
            rmSync(join(folder, outfile) + (isWindows ? ".exe" : ""), { force: true });
          }
          for (const line of counts) {
            const [, statistic, relation, bound] = /^(\w+) (=|>=|<=) (\d+)$/.exec(line) ?? [];
            const counted = Number(new RegExp(`^${statistic} (\\d+)$`, "m").exec(build.stderr)?.[1]);
            const holds = { "=": counted === +bound, ">=": counted >= +bound, "<=": counted <= +bound }[relation];
            expect({ line, counted, holds }).toEqual({ line, counted, holds: true });
          }
        }),
      240_000,
    );
  });
}
