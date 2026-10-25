// One program, one compiler, one source text: ./an-interface-over-what-a-plain-function-constructs-costs-no-more-than-erased/main.ts on the package beside it, which names its TypeScript under
// the "aot" condition. It is built as it is written and built again with --aot-erase-types. The package's objects are made by `function Made(this: any, ..)` under `new` and are called by the
// name of an interface through a cast, as a well-known validation library makes its schemas. No object that runs has the shape the interface was given, so the types there say nothing that
// holds. A type that says nothing may not cost more than no type.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countTurn, functionsOf, type Turn } from "./impostors-keep-their-fast-paths/look";
import { whyInstructionsCannotBeCounted } from "./instruction-counts/count-instructions";
import { built, slot, spawned, unsupported } from "./run-programs";
import { installPackage } from "./typed-packages/install-package";

const fixture = join(import.meta.dir, "an-interface-over-what-a-plain-function-constructs-costs-no-more-than-erased");

const whyNotCounted = unsupported
  ? ""
  : isASAN || isDebug
    ? "the counts are those of a release build"
    : await whyInstructionsCannotBeCounted();

// A turn of the typed build costs 1.03 times the instructions of the erased build: where the erased build has proven what arrives, the typed build tests for it once. It belongs at 1: the todo test.
const known = { instructionsOfATurn: 1.05 };

describe.skipIf(!!unsupported)(
  "compile/aot/an-interface-over-what-a-plain-function-constructs-costs-no-more-than-erased",
  () => {
    let folder = "";
    const seen: Record<"typed" | "erased", { turn?: Turn }> = { typed: {}, erased: {} };
    afterAll(() => folder && rmSync(folder, { recursive: true, force: true }));

    beforeAll(
      () =>
        slot(async () => {
          folder = String(tempDir("aot-interface-over-constructed", {}));
          for (const file of ["main.ts", "tsconfig.json"]) cpSync(join(fixture, file), join(folder, file));
          installPackage(join(fixture, "package"), folder);
          for (const [way, flags] of [
            ["typed", []],
            ["erased", ["--aot-erase-types"]],
          ] as const) {
            const map = join(folder, way + ".map"),
              report = join(folder, way + ".json");
            const build = await spawned(
              [
                bunExe(),
                "build",
                "--compile",
                "--aot",
                ...flags,
                `--aot-report=${report}`,
                "--outfile",
                way,
                "main.ts",
              ],
              folder,
              { ...bunEnv, BUN_JSC_aotMapFilePath: map },
            );
            built(build);
            expect(build.stdout + build.stderr).not.toMatch(/compiled (untyped|without (its |their )?types)/);
            expect(JSON.parse(readFileSync(report, "utf8")).statistics.TypedVersionsUsed).toBe(1);
            if (!whyNotCounted)
              seen[way].turn = await countTurn(
                bunExe(),
                join(folder, way),
                functionsOf(readFileSync(map, "utf8")),
                way,
                bunEnv,
              );
          }
        }),
      600_000,
    );

    const instructionsOf = (turn: Turn) => turn.compiled + turn.outside;
    function sharesOf(turn: Turn) {
      return new Map(
        turn.shares.map(share => [
          share.slice(0, share.lastIndexOf(" ")),
          Number(share.slice(share.lastIndexOf(" ") + 1)),
        ]),
      );
    }
    function whereTypesCostMost() {
      const typed = sharesOf(seen.typed.turn!),
        erased = sharesOf(seen.erased.turn!);
      return [...new Set([...typed.keys(), ...erased.keys()])]
        .map(where => ({ where, typed: typed.get(where) ?? 0, erased: erased.get(where) ?? 0 }))
        .sort((a, b) => b.typed - b.erased - (a.typed - a.erased))
        .slice(0, 16)
        .map(row => `${row.where}: ${row.typed} typed, ${row.erased} erased`);
    }
    function expectAtMost(share: number) {
      const typed = instructionsOf(seen.typed.turn!),
        erased = instructionsOf(seen.erased.turn!),
        where = whereTypesCostMost();
      expect({ typed, erased, where, isKept: typed <= erased * share }).toEqual({ typed, erased, where, isKept: true });
    }

    test.skipIf(!!whyNotCounted)("both print the same", () => {
      expect(seen.typed.turn!.stdout).toBe(seen.erased.turn!.stdout);
      expect(seen.typed.turn!.stdout).toStartWith("60 ");
    });
    test.skipIf(!!whyNotCounted)("the instructions of a turn have not risen against the erased build", () =>
      expectAtMost(known.instructionsOfATurn),
    );
    test.todo("a turn costs no more with its types than without them", () => expectAtMost(1));
  },
);
