// Nothing that depends on the machine, the environment or the moment of the run may be computed when a program is built: time zone, locale, environment
// variables, working directory, arguments, colors, file mode mask, clock. The cases of the fixture are built in one environment: those that set the time zone
// in one program, those that only read in another. The executable and plain Bun then run it in another environment and must agree.
// `process.env.NODE_ENV` written out is not among the cases: the bundler replaces it at every build, with --aot and without.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { basename, join } from "path";
import { built, spawned, told, unsupported } from "./harness/commands";

const lines = readFileSync(join(import.meta.dir, "built-in-one-environment-run-in-another.fixture.mjs"), "utf8").split(
  "\n",
);
const nameOfCase = (line: string) => /^await t\("([^"]+)"/.exec(line)?.[1];

const settings = (value: string) => ({
  MY_SETTING: value,
  BUN_PUBLIC_SETTING: value,
  PUBLIC_SETTING: value,
  VITE_SETTING: value,
  NEXT_PUBLIC_SETTING: value,
});
const atTheBuild = {
  ...bunEnv,
  ...settings("build"),
  TZ: "UTC",
  LANG: "C",
  LC_ALL: "C",
  NODE_ENV: "production",
  ONLY_AT_BUILD: "1",
  HOME: "/build-home",
  FORCE_COLOR: "1",
  NO_COLOR: undefined,
};
const atTheRun = {
  ...bunEnv,
  ...settings("run"),
  TZ: "Asia/Tokyo",
  LANG: "de_DE.UTF-8",
  LC_ALL: "de_DE.UTF-8",
  NODE_ENV: "development",
  ONLY_AT_RUN: "1",
  HOME: "/run-home",
  FORCE_COLOR: undefined,
  NO_COLOR: "1",
};

describe.concurrent("compile/aot/built in one environment, run in another", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  if (isWindows) return void test.skip("the runs set the file mode mask with a POSIX shell", () => {});
  test.each([
    ["what a program reads", false],
    ["a time zone that the program sets", true],
  ])(
    "%s",
    async (_, takesWhatSetsTheTimeZone) => {
      using dir = tempDir("aot-other-environment", {
        "build/main.mjs": lines
          .filter(line => [undefined, takesWhatSetsTheTimeZone].includes(nameOfCase(line)?.startsWith("time zone ")))
          .join("\n"),
        "build/only-in-the-build-directory.txt": "build",
        "plain/run/only-in-the-run-directory.txt": "run",
        "compiled/run/only-in-the-run-directory.txt": "run",
      });
      const root = String(dir);
      const executable = join(root, "program");
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable],
          join(root, "build"),
          atTheBuild,
        ),
      );
      const run = (cmd: string[], folder: string, program: string) =>
        spawned(
          ["/bin/sh", "-c", `ulimit -c 0 && umask 077 && exec "$@"`, "--", ...cmd, "one", "two", "--flag"],
          join(root, folder, "run"),
          {
            ...atTheRun,
            STARTED_AFTER: String(Date.now() - 1),
            PID_OF_THE_BUILD: "1",
            NAME_OF_THE_PROGRAM: basename(program),
          },
        );
      const plain = await run([bunExe(), "run", join(root, "build", "main.mjs")], "plain", bunExe());
      const compiled = await run([executable], "compiled", executable);
      expect(compiled.signal).toBeNull();
      expect(plain.stdout.split("\n").length).toBeGreaterThan(3);
      expect(told(compiled)).toEqual(told(plain));
    },
    600_000,
  );
});
