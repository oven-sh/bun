// Runs ../answers and ../from-source: tests of the engine that hold a program and no records.
// A file of ../answers has the head of an IR test of the engine and a small program that tells its answers. A file of ../from-source is an IR test
// of which only the comments are kept: they hold its program, between `# -- source:` and `# -- end of source`, and its check lines.
// The records are made with the front end of the Bun under test (../tools/answers-test-from-source.ts, ../tools/update-ir-tests.ts).
// Then `testaot run` does what the head says: it holds what `walk`, `link` or `plan` print against the check lines; it builds a program that tells
// its answers, runs it in the shell, has the shell run the text itself, and compares answer by answer.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { slot } from "../harness/commands";
import { expectEveryTestPasses, skipOrFail, whyNoShell } from "./testaot";

// `--mechanisms=none`, say: then only the run in the shell runs, on code that no mechanism has touched.
const moreFlags = (process.env.AOT_ANSWERS_FLAGS ?? "").split(" ").filter(Boolean);

export const answersTests = (part: number, parts: number) =>
  testsMadeOf(
    "answers",
    ["answers-test-from-source.ts", "--stored"],
    /\.(ts|js|mjs)$/,
    "programs that tell their answers",
    part,
    parts,
  );

export const fromSourceTests = (part: number, parts: number) =>
  testsMadeOf(
    "from-source",
    ["update-ir-tests.ts", "--print-anew"],
    /\.ir$/,
    "tests that hold their source",
    part,
    parts,
  );

/** Every `parts`-th file of the folder, from the `part`-th on. A new file needs no list: it is in one of the parts. */
function testsMadeOf(folderName: string, tool: string[], isTest: RegExp, title: string, part: number, parts: number) {
  if (whyNoShell) return void skipOrFail(whyNoShell);
  const folder = join(import.meta.dir, "..", folderName);
  const mine = readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter(name => isTest.test(name))
    .map(name => name.replaceAll("\\", "/"))
    .sort()
    .filter((_, index) => index % parts === part - 1);
  test(`${mine.length} ${title}`, async () => {
    using made = tempDir("aot-tests-made", {});
    const notMade: string[] = [];
    const tests = await Promise.all(
      mine.map(name =>
        slot(async () => {
          await using child = Bun.spawn({
            cmd: [bunExe(), join(import.meta.dir, "..", "tools", tool[0]), tool[1], join(folder, name)],
            // Without a front end named, ../shell/tools builds a program and writes an executable to learn whether this Bun is one.
            // The tool builds with this Bun whatever the answer, and a Bun that writes no program is a test that could not be made.
            env: { ...bunEnv, FRONT_END: bunExe() },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [text, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
          if (exitCode !== 0 || !text.includes("\nmodule ")) {
            notMade.push(`${name}: ended with ${exitCode}: ${stderr.slice(-600)}`);
            return [];
          }
          const path = name.replace(/\.\w+$/, ".ir");
          mkdirSync(dirname(join(String(made), path)), { recursive: true });
          writeFileSync(join(String(made), path), text);
          return [path];
        }),
      ),
    );
    const ran = await expectEveryTestPasses(["run", ...moreFlags, ...tests.flat()], String(made));
    // A file of which no test could be made has not been tested.
    expect({ notMade, ran }).toEqual({ notMade: [], ran: mine.length });
  }, 600_000);
}
