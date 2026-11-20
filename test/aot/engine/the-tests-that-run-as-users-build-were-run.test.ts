// A file with a line `# AS-USERS-BUILD: <why>` is the red control of a check that runs in every build. Where the checks are on from outside it would show nothing, so
// `testaot run` does not run it: it says "NOT RUN, not as users build here: <what turns them on>" and counts the file among the passed. A lane in which every such
// file goes unrun looks green. This file runs them by themselves and holds which of the two happened.
// With a check asked for on the command line none of them may run, and each says what stands in its way: the assertions or the sanitizer of this testaot where it has
// them, else the command line. So testaot tells in its own words which kind it is. Without the flag, one that has neither runs every file and says the sentence of
// none; one that has them says the same sentences again.
// ../the-tests-that-run-as-users-build-are-listed.test.ts lists the files.
import { Glob } from "bun";
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "../supported";
import { runTool, skipOrFail, testaot, whyNoTestaot } from "./testaot";

const sentence = "NOT RUN, not as users build here: ";
const folder = join(import.meta.dir, "..");

if (whyNoTestaot) skipOrFail(whyNoTestaot);
else
  test("the tests that run as users build were run, or testaot says what stood in the way", async () => {
    const files = [...new Glob("from-source/**/*.ir").scanSync(folder)]
      .map(file => file.replaceAll("\\", "/"))
      .filter(file => /^# AS-USERS-BUILD:/m.test(readFileSync(join(folder, file), "utf8")))
      .sort();
    expect(files).not.toEqual([]);

    using made = tempDir("aot-tests-made", {});
    for (const file of files) {
      await using child = Bun.spawn({
        cmd: [bunExe(), join(folder, "tools", "update-ir-tests.ts"), "--print-anew", join(folder, file)],
        env: { ...bunEnv, FRONT_END: bunExe() },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [text, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
      const isMade = exitCode === 0 && text.includes("\nmodule ");
      expect({ file, isMade, stderr: isMade ? "" : stderr.slice(-600) }).toEqual({ file, isMade: true, stderr: "" });
      mkdirSync(dirname(join(String(made), file)), { recursive: true });
      writeFileSync(join(String(made), file), text);
    }

    const whatStoodInTheWay = async (...flags: string[]) => {
      const { lines, stderr, exitCode } = await runTool([testaot!, "run", ...flags, ...files], String(made));
      expect({ failed: lines.filter(line => line.startsWith("FAIL ")), lastLine: lines.at(-1), exitCode }).toEqual({
        failed: [],
        lastLine: `${files.length} passed, 0 failed, 0 todo`,
        exitCode: 0,
      });
      return [...lines, ...stderr.split(/\r?\n/)]
        .filter(line => line.startsWith(sentence))
        .map(line => line.slice(sentence.length).split(": AS-USERS-BUILD: ")[0]);
    };

    const underCheck = await whatStoodInTheWay("--option=check=VerifyEachStage");
    expect({ sentences: underCheck.length, kinds: [...new Set(underCheck)].length }).toEqual({
      sentences: files.length,
      kinds: 1,
    });
    const hasChecksOfItsOwn = underCheck[0] !== "the command line asks for a check";
    if (hasChecksOfItsOwn) expect(underCheck[0]).toMatch(/^this testaot has (assertions|the sanitizer)$/);
    expect(await whatStoodInTheWay()).toEqual(hasChecksOfItsOwn ? underCheck : []);
  }, 300_000);
