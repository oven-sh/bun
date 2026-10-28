// What fuzzer-fixed-seeds.test.ts and fuzzer-fixed-seeds-in-several-files.test.ts do. Each has a file of its own, because the runner of CI gives a file so much time and no more.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { bunExe, tempDir } from "harness";
import { availableParallelism } from "os";
import { join } from "path";
import { freshSeed } from "./harness/shares";
import { ProductBed } from "./fuzz/beds";
import { fuzz } from "./fuzz/fuzzer";
import { allSources } from "./fuzz/sources";
import { unsupported } from "./harness/commands";

const inOneFile = Number(process.env.AOT_FUZZ_PROGRAMS) || 45;
const seeds = process.env.AOT_FUZZ_SEED
  ? [Number(process.env.AOT_FUZZ_SEED)]
  : freshSeed === undefined
    ? [1]
    : [1, freshSeed];
const secondsPerProgram = 4;
// TODO: each of these gets a generated-<its name>.test.ts and goes out of this list.
const withoutFixedSeedsYet = [
  "strings-grown-piece-by-piece-on-many-paths",
  "compiled-code-calls-text-made-at-run-time",
  "methods-of-helper-objects-define-members-under-written-names",
  "long-array-literals-of-mixed-constants",
  "very-many-values-alive-across-very-many-blocks",
];

/** So large a share of the programs. `form` is what stands behind the name of each source: nothing, or `inSeveralFiles`. */
export function printTheSame(share: number, form: string) {
  const programs = Math.ceil(inOneFile * share);
  for (const seed of seeds)
    test.skipIf(!!unsupported)(
      `${programs} programs from seed ${seed}${form && ", each in several files,"} print the same compiled and plain`,
      async () => {
        using folder = tempDir("aot-fuzzer-fixed-seeds", {});
        const out = join(String(folder), "out");
        const programsRoot = join(import.meta.dir, "parallel");
        // A source with fixed seeds of its own, in generated-<its name>.test.ts, is left to that test: a new one does not move what is drawn here. The programs as they are have tests of their own.
        const sources = Object.keys(await allSources(programsRoot, new Set()))
          .filter(
            name =>
              name !== "programs-as-they-are" &&
              !withoutFixedSeedsYet.includes(name) &&
              !existsSync(join(import.meta.dir, `generated-${name}.test.ts`)),
          )
          .map(name => name + form);
        const bed = new ProductBed(bunExe(), {
          baseFlags: [],
          validate: true,
          threads: 2,
          buildSeconds: 300,
          runSeconds: 20,
          validatedRunSeconds: 60,
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
}
