// One program, one compiler: ./typed-react-costs-no-more-than-erased/terminal.ts on the full types of react-reconciler under packages/full-types, as they are written and again with
// `Lane` and `Lanes`, the bit sets that the reconciler tests and joins everywhere, as `number`. An `int32` is knowledge that a `number` is not: a turn has to cost less with it.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { countTurn, functionsOf, type Turn } from "./impostors-keep-their-fast-paths/look";
import { whyInstructionsCannotBeCounted } from "./instruction-counts/count-instructions";
import { built, slot, spawned, unsupported } from "./run-programs";

const host = join(import.meta.dir, "typed-packages", "react-reconciler-host");
const fullTypes = join(
  import.meta.dir,
  "..",
  "..",
  "packages",
  "full-types",
  "react-reconciler",
  "0.33.0",
  "lay",
  "cjs",
);
const whyNotCounted = unsupported
  ? ""
  : isASAN || isDebug
    ? "the counts are those of a release build"
    : await whyInstructionsCannotBeCounted();

// A turn with `int32` costs 0.973 times the instructions of a turn with `number`. The share may not pass this.
const known = 0.98;

describe.skipIf(!!unsupported || !!whyNotCounted)(
  "compile/aot/int32-lanes-of-react-reconciler-cost-less-than-numbers",
  () => {
    const folders: string[] = [];
    const seen: Partial<Record<"int32" | "number", Turn>> = {};
    afterAll(() => folders.forEach(folder => rmSync(folder, { recursive: true, force: true })));

    beforeAll(
      () =>
        slot(async () => {
          const written = readFileSync(join(fullTypes, "react-reconciler.production.js"), "utf8");
          expect(written).toContain("  type Lane = int32;\n  type Lanes = int32;\n");
          for (const [way, text] of [
            ["int32", written],
            [
              "number",
              written.replace(
                "  type Lane = int32;\n  type Lanes = int32;\n",
                "  type Lane = number;\n  type Lanes = number;\n",
              ),
            ],
          ] as const) {
            const folder = String(tempDir("aot-int32-lanes-" + way, {}));
            folders.push(folder);
            cpSync(
              join(import.meta.dir, "typed-react-costs-no-more-than-erased", "terminal.ts"),
              join(folder, "terminal.ts"),
            );
            for (const file of ["modules.d.ts", "tsconfig.json"]) cpSync(join(host, file), join(folder, file));
            const reconciler = join(folder, "node_modules", "react-reconciler");
            mkdirSync(join(reconciler, "cjs"), { recursive: true });
            for (const name of ["react", "scheduler"])
              cpSync(join(host, "stand-ins", name), join(folder, "node_modules", name), { recursive: true });
            writeFileSync(
              join(reconciler, "package.json"),
              JSON.stringify({ name: "react-reconciler", version: "0.33.0", main: "index.js" }),
            );
            writeFileSync(
              join(reconciler, "index.js"),
              `"use strict";\nmodule.exports = require("./cjs/react-reconciler.production.ts");\n`,
            );
            writeFileSync(join(reconciler, "cjs", "react-reconciler.production.ts"), text);

            const map = join(folder, way + ".map");
            built(
              await spawned(
                [
                  bunExe(),
                  "build",
                  "--compile",
                  "--aot",
                  "--define",
                  `process.env.NODE_ENV="production"`,
                  "--outfile",
                  way,
                  "terminal.ts",
                ],
                folder,
                { ...bunEnv, BUN_JSC_aotMapFilePath: map },
              ),
            );
            seen[way] = await countTurn(
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

    test("both print the same", () => {
      expect(seen.int32!.stdout).toBe(seen.number!.stdout);
      expect(seen.int32!.stdout).toStartWith("60 ");
    });

    test("a turn costs less with int32 than with number", () => {
      const [int32, number] = [seen.int32!, seen.number!].map(turn => turn.compiled + turn.outside);
      expect({ int32, number, isKept: int32 <= number * known }).toEqual({ int32, number, isKept: true });
    });
  },
);
