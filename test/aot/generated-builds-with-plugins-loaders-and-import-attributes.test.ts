// Fixed seeds of fuzz/builds-with-plugins-loaders-and-import-attributes.ts: files that are no code, imports that say how a file is to be read, loaders and definitions of the build, and plugins
// that resolve and load. A program that needs nothing of the build prints as an executable what `bun main.ts` prints. One that needs the build is built twice by one build script,
// with and without `aot`, and both executables print the same.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { program } from "./fuzz/builds-with-plugins-loaders-and-import-attributes";
import { slot, spawned, unsupported } from "./run-programs";

const seeds = [
  981830000000008,
  981830000000009,
  981830000000025,
  981830000000053,
  981830000000082,
  981830000000089,
  ...Array.from({ length: 24 }, (_, index) => index + 1),
];

describe.concurrent("compile/aot/generated/builds with plugins, loaders and import attributes", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const seed of seeds) {
    test(`seed ${seed}`, () =>
      slot(async () => {
        const { files, byCommandLine, runsInPlace } = program(seed);
        using dir = tempDir("aot-generated-builds", files);
        const folder = String(dir);
        const built = (how: "bundle" | "aot") =>
          spawned(
            byCommandLine
              ? [
                  bunExe(),
                  "build",
                  "--compile",
                  ...(how === "aot" ? ["--aot"] : []),
                  ...byCommandLine,
                  "./main.ts",
                  "--outfile",
                  "app-" + how,
                ]
              : [bunExe(), "build.ts", "app-" + how, how],
            folder,
            bunEnv,
          );
        const executable = (how: "bundle" | "aot") => join(folder, "app-" + how + (isWindows ? ".exe" : ""));
        // What is refused without `aot` too says nothing about it.
        if (!runsInPlace && (await built("bundle")).exitCode !== 0) return;
        const expected = await spawned(runsInPlace ? [bunExe(), "main.ts"] : [executable("bundle")], folder, bunEnv);
        const build = await built("aot");
        expect({ said: build.stdout + build.stderr, exitCode: build.exitCode, signal: build.signal }).toEqual({
          said: expect.any(String),
          exitCode: 0,
          signal: null,
        });
        const compiled = await spawned([executable("aot")], folder, bunEnv);
        expect({ stdout: compiled.stdout, exitCode: compiled.exitCode, signal: compiled.signal }).toEqual({
          stdout: expected.stdout,
          exitCode: expected.exitCode,
          signal: null,
        });
      }));
  }
});
