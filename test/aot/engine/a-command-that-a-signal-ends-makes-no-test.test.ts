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
import { skipOrFail, testaot, whyNoTestaot } from "./testaot";

const otherwiseTestaot = `exec "$REAL_TESTAOT" "$@"\n`;
const files = {
  "stored.js": `// answers: with-library\n// # One answer.\n// # RUN: run-in-shell $SHELL\nreport(1);\nreport("end");\n`,
  "held.ir": "# -- source: main.ts\n# console.log(1);\n# -- end of source\n# RUN: walk\n",
  // SIGKILL leaves no core behind.
  "dies-at-link": `#!/bin/sh\nif [ "$1" = link ]; then kill -KILL $$; fi\n${otherwiseTestaot}`,
  "stops-at-link": `#!/bin/sh\nif [ "$1" = link ]; then echo it stops >&2; exit 1; fi\n${otherwiseTestaot}`,
  "refuses-to-print": `#!/bin/sh\nif [ "$1" = print ]; then echo it refuses >&2; exit 3; fi\n${otherwiseTestaot}`,
};
const ways = [
  ["answers-test-from-source.ts", "--stored", "stored.js"],
  ["update-ir-tests.ts", "--print-anew", "held.ir"],
] as const;

async function made(
  standIn: "dies-at-link" | "stops-at-link" | "refuses-to-print",
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
  return { isMade: stdout.includes("\nmodule "), stderr, exitCode };
}

if (whyNoTestaot) skipOrFail(whyNoTestaot);
else {
  test.concurrent.skipIf(isWindows).each(ways)(
    "%s %s: a link that stops behind the written program makes the test",
    async (tool, flag, file) => {
      expect(await made("stops-at-link", tool, flag, file)).toEqual({ isMade: true, stderr: "", exitCode: 0 });
    },
  );

  test.concurrent.skipIf(isWindows).each(ways)(
    "%s %s: a link that a signal ends makes none",
    async (tool, flag, file) => {
      expect(await made("dies-at-link", tool, flag, file)).toEqual({
        isMade: false,
        stderr: expect.stringMatching(/[\\/]dies-at-link link \S+program\.aot functions ended with SIGKILL:/),
        exitCode: 1,
      });
    },
  );

  test.concurrent.skipIf(isWindows).each(ways)(
    "%s %s: a command that fails where nothing is written makes none",
    async (tool, flag, file) => {
      expect(await made("refuses-to-print", tool, flag, file)).toEqual({
        isMade: false,
        stderr: expect.stringMatching(/[\\/]refuses-to-print print \S+program\.aot ended with 3:/),
        exitCode: 1,
      });
    },
  );

  test.concurrent.skipIf(isWindows)(
    "the command that failed says what it wrote where ./answers.ts reads it",
    async () => {
      expect((await made("refuses-to-print", ...ways[0])).stderr).toMatch(/ ended with 3:\nit refuses\n/);
    },
  );
}
