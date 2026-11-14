// Programs that were once compiled wrongly, each held to what it must print. Every .txt file of ./fixed holds some, and no formatter rewrites them.
// A line that begins with "#### " begins a part:
//   #### name.js, #### name/lib/a.js   a file. The first file of a name is where the program starts
//   #### name prints                   what it writes to stdout, which is what `bun run` writes. `#### name prints, exit code 1` where it ends so
//   #### name flags --aot-erase-types  more flags for its build
//   #### name counts                   lines such as `ImageFunctionsEmitted >= 1`, with = or >= or <=: what --explain=statistics says of its build
//   #### name alone                    says nothing
// Each program is the one entry point of a build of its own, so none hides the fault of another, and a build that fails takes no other program along.
// To see a new one fail: <a Bun that has the fault> test test/aot/fixed.test.ts -t "<name>"
import { expect } from "bun:test";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { sharedBuilds } from "./harness/shared-builds";
import { describe, test } from "./supported";

type Program = {
  files: Record<string, string>;
  prints?: { stdout: string; exitCode: number };
  flags: string[];
  counts: string[];
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
    if (!programs.has(name)) programs.set(name, { files: {}, flags: [], counts: [] });
    const program = programs.get(name)!;
    if (!kind) program.files[path] = body;
    else if (kind === "prints")
      program.prints = { stdout: body, exitCode: Number(rest?.replace("exit code ", "") ?? 0) };
    else if (kind === "flags") program.flags = rest.split(" ");
    else if (kind === "counts") program.counts = body.split("\n").filter(line => line);
  }
  return programs;
}

const folderOfPrograms = join(import.meta.dir, "fixed");

for (const file of readdirSync(folderOfPrograms).sort()) {
  if (!file.endsWith(".txt")) continue;
  const programs = read(readFileSync(join(folderOfPrograms, file), "utf8"));
  describe(file.slice(0, -".txt".length), () => {
    const filesOfAll = Object.assign({}, ...[...programs.values()].map(({ files }) => files));
    const { folder, build } = sharedBuilds("fixed", filesOfAll);
    test.concurrent.each([...programs.keys()])(
      "%s",
      async name => {
        const { files, prints, flags, counts } = programs.get(name)!;
        const statistics = counts.length ? ["--explain=statistics"] : [];
        const built = await build("./" + Object.keys(files)[0], "--aot", "--root=.", ...flags, ...statistics);
        // An executable is the size of Bun, and nothing but this test starts this one.
        const removeExecutable = () => rmSync(built.file, { force: true });
        const { stdout, exitCode } = await run([built.executable], folder).finally(removeExecutable);
        expect({ stdout, exitCode }).toEqual(prints!);
        for (const line of counts) {
          const [, statistic, relation, bound] = /^(\w+) (=|>=|<=) (\d+)$/.exec(line) ?? [];
          const counted = Number(new RegExp(`^${statistic} (\\d+)$`, "m").exec(built.stderr)?.[1]);
          const holds = { "=": counted === +bound, ">=": counted >= +bound, "<=": counted <= +bound }[relation];
          expect({ line, counted, holds }).toEqual({ line, counted, holds: true });
        }
      },
      240_000,
    );
  });
}
