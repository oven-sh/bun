// ../tools/ir-test-from-source.ts starts three commands for a file: the front end, `testaot print` and `testaot link`. ./answers.ts makes the tests
// of its folders with them. `testaot link` may end with 1 behind a written program: the engine has stopped the build with a diagnostic, and the
// test is made without the bodies of the library. A command that a signal has ended has made no test, whatever is written, and neither has one
// that fails where nothing is written: the tool names the command, and how it ended.
// Here a script stands in for testaot, and each of the two tools is started as ./answers.ts starts it.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { skipOrFail, testaot, whyNoShell } from "./testaot";

const otherwiseTestaot = `exec "$REAL_TESTAOT" "$@"\n`;
// A built-in that is written in JavaScript: a link that runs to its end keeps modules of the library in the test.
const answer = "[1, 2].map(value => value + 1).length";
const files = {
  "stored.js": `// answers: with-library\n// # One answer.\n// # RUN: run-in-shell $SHELL\nreport(${answer});\nreport("end");\n`,
  "held.ir": `# -- source: main.ts\n# console.log(${answer});\n# -- end of source\n# RUN: walk\n`,
  "links": `#!/bin/sh\n${otherwiseTestaot}`,
  // SIGKILL leaves no core behind.
  "dies-at-link": `#!/bin/sh\nif [ "$1" = link ]; then kill -KILL $$; fi\n${otherwiseTestaot}`,
  "stops-at-link": `#!/bin/sh\nif [ "$1" = link ]; then echo it stops >&2; exit 1; fi\n${otherwiseTestaot}`,
  "refuses-to-print": `#!/bin/sh\nif [ "$1" = print ]; then echo it refuses >&2; exit 3; fi\n${otherwiseTestaot}`,
};
const ways = [
  ["answers-test-from-source.ts", "--stored", "stored.js"],
  ["update-ir-tests.ts", "--print-anew", "held.ir"],
] as const;

/** The modules in the test that a tool printed: those of the program, and those of the library. */
function modulesOf(text: string) {
  const modules = text.split("\n").filter(line => line.startsWith("module "));
  const ofTheLibrary = modules.filter(line => / kind=Runtime| flags=\[[^\]]*\bIsLibrary\b/.test(line)).length;
  return { ofTheProgram: modules.length - ofTheLibrary, ofTheLibrary };
}
const noTest = { ofTheProgram: 0, ofTheLibrary: 0 };

async function made(
  standIn: "links" | "dies-at-link" | "stops-at-link" | "refuses-to-print",
  tool: string,
  flag: string,
  file: string,
) {
  using folder = tempDir("a-command-that-a-signal-ends", files);
  chmodSync(join(String(folder), standIn), 0o755);
  await using child = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "..", "tools", tool), flag, join(String(folder), file)],
    // The front end is named as ./answers.ts names it: without one, ../shell/tools builds a program when the tool loads it.
    env: { ...bunEnv, FRONT_END: bunExe(), TESTAOT: join(String(folder), standIn), REAL_TESTAOT: testaot },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { modules: modulesOf(stdout), stderr, exitCode };
}

// As ./answers.ts: ../shell/tools, which the tools load, refuses to go on where there is a testaot and no jsc.
if (whyNoShell) skipOrFail(whyNoShell);
else {
  test.concurrent.skipIf(isWindows).each(ways)(
    "%s %s: a link that runs to its end keeps what the program reaches in the library",
    async (tool, flag, file) => {
      const { modules, stderr, exitCode } = await made("links", tool, flag, file);
      expect({ ofTheProgram: modules.ofTheProgram, stderr, exitCode }).toEqual({
        ofTheProgram: 1,
        stderr: "",
        exitCode: 0,
      });
      expect(modules.ofTheLibrary).toBeGreaterThan(0);
    },
  );

  test.concurrent.skipIf(isWindows).each(ways)(
    "%s %s: a link that stops behind the written program makes the test, without the library",
    async (tool, flag, file) => {
      expect(await made("stops-at-link", tool, flag, file)).toEqual({
        modules: { ofTheProgram: 1, ofTheLibrary: 0 },
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.concurrent.skipIf(isWindows).each(ways)(
    "%s %s: a link that a signal ends makes none",
    async (tool, flag, file) => {
      expect(await made("dies-at-link", tool, flag, file)).toEqual({
        modules: noTest,
        stderr: expect.stringMatching(/[\\/]dies-at-link link .+program\.aot functions ended with SIGKILL:/),
        exitCode: 1,
      });
    },
  );

  test.concurrent.skipIf(isWindows).each(ways)(
    "%s %s: a command that fails where nothing is written makes none",
    async (tool, flag, file) => {
      expect(await made("refuses-to-print", tool, flag, file)).toEqual({
        modules: noTest,
        stderr: expect.stringMatching(/[\\/]refuses-to-print print .+program\.aot ended with 3:/),
        exitCode: 1,
      });
    },
  );

  // `--print-anew` prints the first line of the message alone: the command and how it ended, which the cases above hold.
  test.concurrent.skipIf(isWindows)(
    `${ways[0][0]} ${ways[0][1]}: what the failed command wrote comes behind its name, where ./answers.ts reads it`,
    async () => {
      expect((await made("refuses-to-print", ...ways[0])).stderr).toMatch(/ ended with 3:\nit refuses\n/);
    },
  );
}
