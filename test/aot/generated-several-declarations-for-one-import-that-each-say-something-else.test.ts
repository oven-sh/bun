// Fixed seeds of fuzz/several-declarations-for-one-import-that-each-say-something-else.ts: one import could take its types from several places (`declare module`, "paths", "exports", "typesVersions", "typings",
// "types", a file beside the main file, `index.d.ts`, @types, a `.ts` or `.d.ts` beside the file, the JavaScript itself), and each place declares another literal type. The program expects what one place says.
// Where that is the place TypeScript reads, the build succeeds and the executable prints what plain Bun prints. Where it is another place, the build stops with TS2322, as TypeScript does.
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { dirname, join } from "path";
import { Random } from "./fuzz/random";
import { generate, imported } from "./fuzz/several-declarations-for-one-import-that-each-say-something-else";
import { generated } from "./generated/run-generated";
import { slot, spawned, unsupported } from "./run-programs";

generated(
  "several declarations for one import that each say something else",
  Array.from({ length: 480 }, (_, index) => {
    const what = imported[index % imported.length];
    return {
      name: `seed ${index + 1}, ${what}.`,
      // Every run takes the first thirty-six seeds, six of each kind of import; AOT_GENERATED=all takes all.
      isAlwaysRun: index < 36,
      isOnlyCompiled: true as const,
      // Nothing is put into the text: it is three lines about where the types come from.
      keepsItsText: true as const,
      make: () => generate(new Random(index + 1), what, false),
    };
  }),
);

describe.concurrent(
  "compile/aot/generated/several declarations for one import, and the program expects what another place says",
  () => {
    if (unsupported) return void test.skip(unsupported, () => {});
    for (let index = 0; index < 48; index++) {
      const what = imported[index % imported.length];
      test(`seed ${index + 1}, ${what}.`, async () => {
        using folder = tempDir("aot-another-place", {});
        const { file, text, files } = generate(new Random(index + 1), what, true);
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
          errors: build.stderr.match(/^error: TS\d+/gm),
          exitCode: build.exitCode,
          signal: build.signal,
        }).toEqual({
          errors: ["error: TS2322"],
          exitCode: 1,
          signal: null,
        });
      });
    }
  },
);
