// Research prototype of the same blocks for the other form of the list: reference_instances.tsv holds every instance, so every difference is a name.
// usage: CGT_ASM=<assembled runner root> CGT_HOME=<conformance directory with corpus/> [CGT_FX=<directory of reference_counts.json and reference_instances.tsv>] bun test ./instances.test.ts
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isASAN, isDebug } from "/workspace/wt/conformance/test/harness.ts";

const asm = process.env.CGT_ASM!;
const home = process.env.CGT_HOME!;
const fx = process.env.CGT_FX ?? home;
const runner = join(asm, "test/cli/lint/conformance/runner");
const R = await import(join(runner, "index.ts"));
const B = await import(join(runner, "baseline.ts"));
const { compareStrings } = await import(join(runner, "gostrings.ts"));
const sha = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");
const digestOf = (rows: string[]) => sha(rows.slice().sort(compareStrings).join(""));
const small = isDebug || isASAN;
const pins = JSON.parse(readFileSync(join(fx, "reference_counts.json"), "utf8"));
const text = readFileSync(join(fx, "reference_instances.tsv"), "utf8");
const lines = text.split("\n").filter(l => l !== "");
const c = home + "/corpus";
const layout = {
  casesRoot: c + "/ts/tests/cases",
  libRoot: c + "/ts/tests/lib",
  tsgoBaselines: c + "/tsgo/testdata/baselines/reference/submodule",
  tsBaselines: c + "/ts/tests/baselines/reference",
  expectsNoErrors: c + "/tsgo.expects-no-errors.txt",
  accepted: c + "/tsgo/testdata/submoduleAccepted.txt",
  triaged: c + "/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: home + "/post-emit-order.txt",
};
const corpus = R.loadCorpus(layout);
const cases: Map<string, string> = R.indexCases(layout.casesRoot);
const rowOf = (f: any) => `${f.name}\t${f.status}\t${f.reason}\t${f.kind ?? ""}`;
const group = (casePath: string) => Bun.hash.crc32(casePath) % 256;
// The rows of the list by the group of their case, made once: a debug build needs a second for it.
const rowsByGroup = new Map<number, string[]>();
for (const l of lines) {
  const k = group(cases.get(R.caseBaseName(l.slice(0, l.indexOf("\t")))) ?? "");
  rowsByGroup.set(k, [...(rowsByGroup.get(k) ?? []), l]);
}

describe("listed enumeration", () => {
  test("the list is the pinned one", () => {
    expect({ rows: lines.length, sha256: sha(text) }).toEqual(pins.list);
  });

  // About 48 cases each: a debug build gets through one group within the time of one test.
  test.each([0, 1, 2, 3, 4, 5, 6, 7])("one of 256 cases, group %d: the rows of the list", k => {
    const sample = [...cases.values()].filter(p => group(p) === k).sort();
    const got = sample.flatMap(p => R.enumerateCase(layout.casesRoot, p)).map((i: any) => rowOf(R.factsOf(corpus, i)));
    expect(got.length).toBeGreaterThan(20);
    expect(got.sort()).toEqual((rowsByGroup.get(k) ?? []).slice().sort());
  });

  test.skipIf(small)(
    "every case: the rows of the list and the counts",
    () => {
      const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
      const facts: any[] = e.instances.map((i: any) => R.factsOf(corpus, i));
      expect(facts.map(rowOf).sort()).toEqual(lines.slice().sort());
      const n = (f: (x: any) => boolean) => facts.filter(f).length;
      const reasons: Record<string, number> = {};
      for (const f of facts) {
        if (f.status !== "skipped") continue;
        const r = f.reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/s, "$1");
        reasons[r] = (reasons[r] ?? 0) + 1;
      }
      const sources: Record<string, number> = {};
      const oracleRows: string[] = [];
      for (const i of e.instances) {
        if (i.status !== "run") continue;
        const o = B.oracleOf(corpus, i.suite, i.name);
        sources[o.source] = (sources[o.source] ?? 0) + 1;
        if (o.kind === "E") oracleRows.push(`${i.name}\t${sha(B.readOracle(o)!)}\n`);
      }
      expect({
        files: e.files,
        droppedByName: e.droppedBySkippedTests.length,
        instances: facts.length,
        run: n(f => f.status === "run"),
        skipped: n(f => f.status === "skipped"),
        invalid: n(f => f.status === "invalid"),
        E: n(f => f.kind === "E"),
        C: n(f => f.kind === "C"),
        skippedByReason: reasons,
        oracleSource: sources,
      }).toEqual({
        files: pins.enumeration.files,
        droppedByName: pins.enumeration.droppedByName,
        instances: pins.enumeration.instances,
        run: pins.enumeration.run,
        skipped: pins.enumeration.skipped,
        invalid: pins.enumeration.invalid,
        E: pins.enumeration.E,
        C: pins.enumeration.C,
        skippedByReason: pins.enumeration.skippedByReason,
        oracleSource: pins.enumeration.oracleSource,
      });
      // The first digest is the one that the run of the reference gives for its own list of subtests; the last holds the bytes of every oracle.
      expect({
        subtests: digestOf(e.instances.map((i: any) => `${i.status === "run" ? "PASS" : i.status === "skipped" ? "SKIP" : i.status}\t${i.testName.replaceAll(" ", "_")}\n`)),
        names: digestOf(facts.map(f => `${f.name}\n`)),
        status: digestOf(facts.map(f => `${f.name}\t${f.status}\t${f.reason}\n`)),
        kinds: digestOf(facts.filter(f => f.status === "run").map(f => `${f.name}\t${f.kind}\n`)),
        oracles: digestOf(oracleRows),
      }).toEqual(pins.digests);
    },
    30_000,
  );
});
