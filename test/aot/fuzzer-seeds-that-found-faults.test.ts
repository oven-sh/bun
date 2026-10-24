import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { ProductBed } from "./fuzz/beds";
import { allSources } from "./fuzz/sources";
import { slot, unsupported } from "./run-programs";

const seeds = [
  "grammar:1792621378449",
  "grammar:1792650538967",
  "grammar:1792651298168",
  "new-objects-kept-through-built-ins:611792807813520",
  "new-targets:1792623820412",
  "new-targets:1792629296563",
  "new-targets:1792633504113",
  "new-targets:1792637698611",
  "new-targets:1792637700324",
  "new-targets:1792641988139",
  "new-targets:1792646151839",
  "object-mutations:1792621381169",
  "object-mutations:1792621382938",
  "object-mutations:1792633492880",
  "object-mutations:1792654672417",
  "objects-read-where-they-are-made:81792802940847",
  "protocols:1792625082015",
  "protocols:1792629290375",
  "protocols:1792629295471",
  "protocols:1792629297559",
  "protocols:1792651312456",
  "unsound-types:1792623818290",
  "unsound-types:1792625088050",
];

const bed = new ProductBed(bunExe(), { baseFlags: [], validate: true, threads: 2, buildSeconds: 300, runSeconds: 20 });
const sources = await allSources(join(import.meta.dir, "programs"), new Set());

describe.concurrent("compile/aot/fuzzer/seeds that found faults", () => {
  for (const name of seeds)
    test.skipIf(!!unsupported)(
      `${name} prints the same compiled and plain`,
      () =>
        slot(async () => {
          using folder = tempDir("aot-fuzzer-seed", {});
          const [source, seed] = name.split(":");
          const program = sources[source](Number(seed), bed)!;
          const verdicts: Record<string, unknown> = {};
          for (const mode of bed.modes(program))
            verdicts[mode.name] = (await bed.judge(String(folder), [program], mode.flags))[0].verdict;
          expect(verdicts).toEqual(Object.fromEntries(bed.modes(program).map(mode => [mode.name, { kind: "same" }])));
        }),
      600_000,
    );
});
