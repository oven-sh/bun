// Fixed seeds of generated/patterns-that-give-a-match-up.ts: an executable gives a match up at the same length of the subject as plain Bun, and takes no longer to get there.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { Random } from "./fuzz/random";
import { generate, type Text } from "./generated/patterns-that-give-a-match-up";
import { inShare } from "./run-programs";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  },
});
const title = "a pattern gives a match up where plain Bun does, and no later";
const texts: Text[] = ["at run time", "literal", "constant"];
const rows = texts.flatMap(text =>
  Array.from({ length: 60 }, (_, index) => index + 1)
    .filter(seed => seed <= (text === "at run time" ? 3 : 1) || inShare(`${title} ${text} ${seed}`, 30))
    .map(seed => [text, seed] as const),
);

// A hundred million turns take a build with a sanitizer or with assertions minutes.
test.skipIf(isASAN || isDebug).concurrent.each(rows)(
  `${title}: its text is %s, seed %d`,
  async (text, seed) => {
    using folder = tempDir("aot-patterns-that-give-a-match-up", {
      "main.ts": generate(new Random(seed), text, 3),
      "tsconfig.json": tsconfig,
    });
    const spawn = (cmd: string[]) =>
      Bun.spawn({ cmd, cwd: String(folder), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    await using build = spawn([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "main"]);
    const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect({ stderr: buildErrors, exitCode: buildExitCode }).toEqual({
      stderr: expect.not.stringMatching(/^error\b|crashed/m),
      exitCode: 0,
    });
    await using plain = spawn([bunExe(), "run", "main.ts"]);
    const [expected, plainExitCode] = await Promise.all([plain.stdout.text(), plain.exited]);
    await using program = spawn([join(String(folder), "main")]);
    const [stdout, exitCode] = await Promise.all([program.stdout.text(), program.exited]);
    const answers = (output: string) => output.replace(/ [0-9]+ms$/gm, "");
    expect({ stdout: answers(stdout), exitCode }).toEqual({ stdout: answers(expected), exitCode: plainExitCode });
    expect(expected).toContain("finds nothing from ");
    const times = (output: string) => Array.from(output.matchAll(/ ([0-9]+)ms$/gm), found => Number(found[1]));
    // A machine that runs many jobs at once holds a process up for a few hundred milliseconds now and then.
    const allowed = times(expected).map(time => time * 3 + 1000);
    expect(
      times(stdout).map((time, at) =>
        time <= allowed[at] ? "in time" : `${time} ms, plain Bun ${times(expected)[at]} ms`,
      ),
    ).toEqual(allowed.map(() => "in time"));
  },
  280_000,
);
