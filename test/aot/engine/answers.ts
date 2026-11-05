// Runs ../answers: small programs that tell their answers, and what the engine must make of them.
// A file there has the head of an IR test of the engine and a program, and no records: ../tools/answers-test-from-source.ts makes them
// with the front end of the Bun under test. Then `testaot run` does what the head says: it builds the program, runs it in the shell, has the
// shell run the text itself, compares answer by answer, and holds what `walk`, `link` or `plan` print against the check lines.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { slot } from "../harness/commands";
import { expectEveryTestPasses, skipOrFail, whyNoShell } from "./testaot";

const folder = join(import.meta.dir, "..", "answers");
const tool = join(import.meta.dir, "..", "tools", "answers-test-from-source.ts");
// `--mechanisms=none`, say: then only the run in the shell runs, on code that no mechanism has touched.
const moreFlags = (process.env.AOT_ANSWERS_FLAGS ?? "").split(" ").filter(Boolean);

/** Every `parts`-th program, from the `part`-th on. A new program needs no list: it is in one of the parts. */
export function answersTests(part: number, parts: number) {
  if (whyNoShell) return void skipOrFail(whyNoShell);
  const mine = readdirSync(folder)
    .filter(name => /\.(ts|js|mjs)$/.test(name))
    .sort()
    .filter((_, index) => index % parts === part - 1);
  test(`${mine.length} programs that tell their answers`, async () => {
    using made = tempDir("aot-answers", {});
    const notMade: string[] = [];
    const tests = await Promise.all(
      mine.map(name =>
        slot(async () => {
          await using child = Bun.spawn({
            cmd: [bunExe(), tool, "--stored", join(folder, name)],
            env: bunEnv,
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
          writeFileSync(join(String(made), path), text);
          return [path];
        }),
      ),
    );
    const passed = await expectEveryTestPasses(["run", ...moreFlags, ...tests.flat()], String(made));
    // A program of which no test could be made has not been tested.
    expect({ notMade, passed }).toEqual({ notMade: [], passed: mine.length });
  }, 600_000);
}
