// Runs ../answers and ../from-source: tests of the engine that hold a program and no records.
// A file of ../answers has the head of an IR test of the engine and a small program that tells its answers. A file of ../from-source is an IR test
// of which only the comments are kept: they hold its program, between `# -- source:` and `# -- end of source`, and its check lines.
// The records are made with the front end of the Bun under test (../tools/answers-test-from-source.ts, ../tools/update-ir-tests.ts).
// Those tools run in this process: for a file they start the front end, `testaot print` and `testaot link`, and no Bun of their own.
// Then `testaot run` does what the head says: it holds what `walk`, `link` or `plan` print against the check lines; it builds a program that tells
// its answers, runs it in the shell, has the shell run the text itself, and compares answer by answer.
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { slot } from "../harness/commands";
import { testOfStoredProgram } from "../tools/answers-test-from-source";
import { printedAnew } from "../tools/update-ir-tests";
import { expectEveryTestPasses, skipOrFail, whyNoShell } from "./testaot";

// `--mechanisms=none`, say: then only the run in the shell runs, on code that no mechanism has touched.
const moreFlags = (process.env.AOT_ANSWERS_FLAGS ?? "").split(" ").filter(Boolean);

/** The test of a file. `unknownIDs`: the ids in it that name no record. */
type Tool = (path: string) => Promise<{ text: string; unknownIDs: string[] }>;

export const answersTests = (part: number, parts: number) =>
  testsMadeOf("answers", testOfStoredProgram, /\.(ts|js|mjs)$/, "programs that tell their answers", part, parts);

export const fromSourceTests = (part: number, parts: number) =>
  testsMadeOf("from-source", printedAnew, /\.ir$/, "tests that hold their source", part, parts);

// A command that failed is named in the first line. What it wrote may be the report of a sanitizer: its start says what was found.
const shown = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 1500 ? message : `${message.slice(0, 900)}\n[..]\n${message.slice(-600)}`;
};

/** Every `parts`-th file of the folder, from the `part`-th on. A new file needs no list: it is in one of the parts. */
function testsMadeOf(folderName: string, tool: Tool, isTest: RegExp, title: string, part: number, parts: number) {
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
          try {
            const { text, unknownIDs } = await tool(join(folder, name));
            if (unknownIDs.length) throw new Error(`these name no record: ${unknownIDs.join(" ")}`);
            if (!text.includes("\nmodule ")) throw new Error("what was made has no module");
            const path = name.replace(/\.\w+$/, ".ir");
            mkdirSync(dirname(join(String(made), path)), { recursive: true });
            writeFileSync(join(String(made), path), text);
            return [path];
          } catch (error) {
            notMade.push(`${name}: ${shown(error)}`);
            return [];
          }
        }),
      ),
    );
    const ran = await expectEveryTestPasses(["run", ...moreFlags, ...tests.flat()], String(made));
    // A file of which no test could be made has not been tested.
    expect({ notMade, ran }).toEqual({ notMade: [], ran: mine.length });
  }, 600_000);
}
