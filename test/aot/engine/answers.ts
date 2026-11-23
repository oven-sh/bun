// Runs ../answers and ../from-source: tests of the engine that hold a program and no records.
// A file of ../answers has the head of an IR test of the engine and a small program that tells its answers. A file of ../from-source is an IR test
// of which only the comments are kept: they hold its program, between `# -- source:` and `# -- end of source`, and its check lines.
// The records are made with the front end of the Bun under test (../tools/answers-test-from-source.ts, ../tools/update-ir-tests.ts).
// Then `testaot run` does what the head says: it holds what `walk`, `link` or `plan` print against the check lines; it builds a program that tells
// its answers, runs it in the shell, has the shell run the text itself, and compares answer by answer.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { slot } from "../harness/commands";
import { expectNoTestFails, skipOrFail, whyNoShell } from "./testaot";

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

/**
 * Every `parts`-th file of the folder, from the `part`-th on. A new file needs no list: it is in one of the parts.
 * A file is run as soon as its test is made, by a `testaot run` of its own: `testaot run` hands sixteen files that follow one another to a
 * process, which runs them one after another, and a test that holds much of the library takes as long as a hundred others.
 */
function testsMadeOf(folderName: string, tool: string[], isTest: RegExp, title: string, part: number, parts: number) {
  if (whyNoShell) return void skipOrFail(whyNoShell);
  const folder = join(import.meta.dir, "..", folderName);
  const mine = readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter(name => isTest.test(name))
    .map(name => name.replaceAll("\\", "/"))
    .sort()
    .filter((_, index) => index % parts === part - 1);
  test(`${mine.length} ${title}`, async () => {
    const outcomes = await Promise.allSettled(
      mine.map(name =>
        slot(async () => {
          await using child = Bun.spawn({
            cmd: [bunExe(), join(import.meta.dir, "..", "tools", tool[0]), tool[1], join(folder, name)],
            env: bunEnv,
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [text, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
          // The tool says on stderr what stood in the way, and also that an id in the text names no record: `testaot run` does not
          // read such a text.
          expect({
            stderr: stderr.slice(-600),
            exitCode,
            signalCode: child.signalCode,
            hasRecords: text.includes("\nmodule "),
          }).toEqual({ stderr: "", exitCode: 0, signalCode: null, hasRecords: true });
          const path = name.replace(/\.\w+$/, ".ir");
          using made = tempDir("aot-tests-made", { [path]: text });
          const counted = await expectNoTestFails(["run", ...moreFlags, path], String(made));
          expect(counted.passed + counted.todo).toBe(1);
          return counted.passed;
        }),
      ),
    );
    // Every file is tried. What stood in the way of one is said under its name, of the first few: a part that fails all over says it once.
    const failed = outcomes.flatMap((outcome, index) =>
      outcome.status === "rejected" ? [{ name: mine[index], reason: outcome.reason }] : [],
    );
    for (const { name, reason } of failed.slice(0, 8)) console.error(`${name}:`, reason);
    // A file of which no test could be made has not been tested. And what `expectEveryTestPasses` holds of one command holds of the commands
    // of a part: a part of which nothing passed has shown nothing.
    const hasPassed = outcomes.some(outcome => outcome.status === "fulfilled" && outcome.value > 0);
    expect({ failed: failed.map(({ name }) => name), hasPassed }).toEqual({ failed: [], hasPassed: true });
  }, 600_000);
}
