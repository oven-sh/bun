// Fixed seeds of fuzz/programs-that-one-compiler-option-accepts-or-refuses.ts: small programs that TypeScript accepts under one value of one compiler option and refuses under the other, with the option said in
// tsconfig.json itself, by `strict`, in files and packages that tsconfig.json extends, overridden, between comments, or in a tsconfig.json above the sources. Where TypeScript accepts the program, the build
// succeeds and the executable prints what plain Bun prints: under `strictNullChecks: false` a `number` holds `null`. Where TypeScript refuses it for one of the options that a build asks about, the build stops with the same error.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
import { generate, options, optionsOfABuild } from "./fuzz/programs-that-one-compiler-option-accepts-or-refuses";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";
import { slot, spawned, unsupported } from "./run-programs";

generated(
  "programs that one compiler option accepts",
  Array.from({ length: options.length * 12 }, (_, index) => {
    const option = options[index % options.length];
    return {
      name: `seed ${index + 1}, ${option}.`,
      // Every run takes one program for each option; AOT_GENERATED=all takes all.
      isAlwaysRun: index < options.length,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: whether it is accepted hangs on every line.
      keepsItsText: true as const,
      make: () => generate(new Random(index + 1), option, false),
    };
  }),
);

describe.concurrent("compile/aot/generated/programs that one compiler option refuses", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (let index = 0; index < optionsOfABuild.length * 3; index++) {
    const option = optionsOfABuild[index % optionsOfABuild.length];
    test(`seed ${index + 1}, ${option}.`, async () => {
      using folder = tempDir("aot-refused-by-an-option", {});
      const { file, text, files, error } = generate(new Random(index + 1), option, true);
      for (const [name, content] of Object.entries({ ...files, [file]: text })) {
        mkdirSync(dirname(join(String(folder), name)), { recursive: true });
        writeFileSync(join(String(folder), name), content);
      }
      const build = await slot(() =>
        spawned(
          [bunExe(), "build", "--compile", "--aot", file, "--outfile", join(String(folder), "program")],
          String(folder),
          bunEnv,
        ),
      );
      expect({
        errors: [...new Set(build.stderr.match(/^error: TS\d+/gm))],
        exitCode: build.exitCode,
        signal: build.signal,
      }).toEqual({
        errors: [`error: ${error}`],
        exitCode: 1,
        signal: null,
      });
    });
  }
});
