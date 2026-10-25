// One program, one compiler: ./typed-packages/small-renderer/terminal.ts on the package small-renderer, which names its TypeScript under the "aot" condition. It is built as the package is
// written and again with `Lane` and `Lanes`, the bit sets that the renderer tests and joins everywhere, as `number`. The lanes of a render come back from task-queue, a package of plain
// JavaScript, so nothing but the type says what they are. An `int32` is knowledge that a `number` is not: a turn has to cost less with it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countTurn, functionsOf, type Turn } from "./impostors-keep-their-fast-paths/look";
import { whyInstructionsCannotBeCounted } from "./instruction-counts/count-instructions";
import { built, slot, spawned, unsupported } from "./run-programs";
import { installSmallRenderer } from "./typed-packages/small-renderer/install";

const whyNotCounted = unsupported
  ? ""
  : isASAN || isDebug
    ? "the counts are those of a release build"
    : await whyInstructionsCannotBeCounted();

// A turn with `int32` costs 0.978 times the instructions of a turn with `number`. The share may not pass this.
const known = 0.985;

describe.skipIf(!!unsupported || !!whyNotCounted)("compile/aot/int32-lanes-cost-less-than-numbers", () => {
  const folders: string[] = [];
  const seen: Partial<Record<"int32" | "number", Turn>> = {};
  afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

  beforeAll(
    () =>
      slot(async () => {
        for (const way of ["int32", "number"] as const) {
          const folder = String(tempDir("aot-int32-lanes-" + way, {}));
          folders.push(folder);
          installSmallRenderer(folder, typed => {
            expect(typed).toContain("type Lane = int32;\ntype Lanes = int32;\n");
            return typed.replace(
              "type Lane = int32;\ntype Lanes = int32;\n",
              `type Lane = ${way};\ntype Lanes = ${way};\n`,
            );
          });
          const map = join(folder, way + ".map");
          const build = await spawned(
            [bunExe(), "build", "--compile", "--aot", "--outfile", way, "terminal.ts"],
            folder,
            {
              ...bunEnv,
              BUN_JSC_aotMapFilePath: map,
            },
          );
          built(build);
          // TS100066 says that an `int32` is tested when the program runs.
          expect(build.stdout + build.stderr).not.toMatch(/TS100066|compiled (untyped|without (its |their )?types)/);
          seen[way] = await countTurn(bunExe(), join(folder, way), functionsOf(readFileSync(map, "utf8")), way, bunEnv);
        }
      }),
    600_000,
  );

  test("both print the same", () => {
    expect(seen.int32!.stdout).toBe(seen.number!.stdout);
    expect(seen.int32!.stdout).toStartWith("60 ");
  });

  test("a turn costs less with int32 than with number", () => {
    const [int32, number] = [seen.int32!, seen.number!].map(turn => turn.compiled + turn.outside);
    expect({ int32, number, isKept: int32 <= number * known }).toEqual({ int32, number, isKept: true });
  });
});
