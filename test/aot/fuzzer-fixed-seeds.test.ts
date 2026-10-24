// A small, fixed part of what test/aot/fuzz/run.ts does without end: programs from the grammar, from the protocols and from mutated
// test programs, each run compiled (with the default flags, validated, and with its types erased) and in plain Bun.
//
//   bun test test/aot/fuzzer-fixed-seeds                                     45 programs from seed 1
//   AOT_FUZZ_PROGRAMS=2000 AOT_FUZZ_SEED=7 bun test test/aot/fuzzer-fixed-seeds
//   AOT_FRESH_SEEDS=1 bun test test/aot/fuzzer-fixed-seeds                   and as many from a seed that no run has used
//
// Every difference that fuzz/accepted-differences.tsv does not explain fails the test. The failure lists the findings, neither
// reduced nor attributed, so that the test stays short; `bun test/aot/fuzz/run.ts --replay <source>:<seed>` shows one program again.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunExe, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { freshSeed } from "./fresh-seed";
import { ProductBed } from "./fuzz/beds";
import { fuzz } from "./fuzz/fuzzer";
import { allSources } from "./fuzz/sources";
import { unsupported } from "./run-programs";

const programs = Number(process.env.AOT_FUZZ_PROGRAMS) || 45;
const seeds = process.env.AOT_FUZZ_SEED
  ? [Number(process.env.AOT_FUZZ_SEED)]
  : freshSeed === undefined
    ? [1]
    : [1, freshSeed];
const secondsPerProgram = 4;

for (const seed of seeds)
  test.skipIf(!!unsupported)(
    `${programs} programs from seed ${seed} print the same compiled and plain`,
    async () => {
      using folder = tempDir("aot-fuzzer-fixed-seeds", {});
      const out = join(String(folder), "out");
      const programsRoot = join(import.meta.dir, "programs");
      // A source with fixed seeds of its own, in generated-<its name>.test.ts, is left to that test: a new one does not move what is drawn here. The programs as they are have tests of their own.
      const sources = Object.keys(await allSources(programsRoot, new Set())).filter(
        name => name !== "programs-as-they-are" && !existsSync(join(import.meta.dir, `generated-${name}.test.ts`)),
      );
      const bed = new ProductBed(bunExe(), {
        baseFlags: [],
        validate: true,
        threads: 2,
        buildSeconds: 300,
        runSeconds: 20,
      });
      const summary = await fuzz({
        beds: [{ bed, jobs: Math.max(1, availableParallelism() >> 1) }],
        out,
        work: join(String(folder), "work"),
        programsRoot,
        sources,
        seconds: programs * secondsPerProgram,
        programs,
        firstSeed: seed,
        known: [join(import.meta.dir, "fuzz", "accepted-differences.tsv")],
        minFreeBytes: 0,
        reduceSeconds: 0,
        attribute: false,
        batch: 1,
      });
      const findings = summary.distinct.map(name => {
        const { bed, mode, kind, detail, source, seed } = JSON.parse(
          readFileSync(join(out, "findings", name, "finding.json"), "utf8"),
        );
        return `${source}:${seed} ${bed} ${mode}: ${kind}: ${detail}`;
      });
      expect(findings).toEqual([]);
      expect(summary.programs).toBeGreaterThan(0);
    },
    (programs * secondsPerProgram + 600) * 1000,
  );
