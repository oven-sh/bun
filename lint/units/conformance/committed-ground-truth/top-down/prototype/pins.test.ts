// Research prototype of the blocks of test/cli/lint/conformance.test.ts that read reference_counts.json (both forms: describe "pinned corpus") and the compact form with reference_skips.tsv and bucket digests (describe "pinned enumeration").
// In the repository: "harness" for the absolute import, "./conformance/runner" for the runner, join(import.meta.dir, "conformance") for CGT_HOME.
// usage: CGT_ASM=<assembled runner root> CGT_HOME=<conformance directory with corpus/> [CGT_FX=<directory of the two files>] bun test ./pins.test.ts
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isASAN, isDebug } from "/workspace/wt/conformance/test/harness.ts";

const asm = process.env.CGT_ASM!;
const home = process.env.CGT_HOME!;
const fx = process.env.CGT_FX ?? home;
const runner = join(asm, "test/cli/lint/conformance/runner");
const R = await import(join(runner, "index.ts"));
const B = await import(join(runner, "baseline.ts"));
const { compareStrings } = await import(join(runner, "gostrings.ts"));

// A debug or sanitizer build enumerates eight buckets of cases; a release build enumerates all of them and reads every file of the corpus.
const small = isDebug || isASAN;
const pins = JSON.parse(readFileSync(join(fx, "reference_counts.json"), "utf8"));
const compact = pins.buckets !== undefined;
const skipsText = compact ? readFileSync(join(fx, "reference_skips.tsv"), "utf8") : "";
const skips = new Map(skipsText.split("\n").filter(l => l !== "").map(l => l.split("\t") as [string, string]));
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
const sha = (x: string | Uint8Array) => createHash("sha256").update(x).digest("hex");
const digestOf = (rows: string[]) => sha(rows.slice().sort(compareStrings).join(""));
const bucketOf = (casePath: string) => Bun.hash.crc32(casePath) % (pins.buckets?.of ?? 256);
const rowOf = (f: any) => `${f.name}\t${f.status}\t${f.reason}\t${f.kind ?? ""}\n`;
const bucketRow = (k: number, part: any[]) => [
  k,
  new Set(part.map(f => f.casePath)).size,
  part.length,
  part.filter(f => f.status === "run").length,
  part.filter(f => f.status === "skipped").length,
  part.filter(f => f.kind === "E").length,
  part.filter(f => f.kind === "C").length,
  digestOf(part.map(rowOf)).slice(0, 16),
];
const corpus = R.loadCorpus(layout);
const cases: Map<string, string> = R.indexCases(layout.casesRoot);
// The rows of the skip list that belong to a set of cases, and the skipped instances of the same cases: the two must be one list.
const skipsOf = (casePaths: Set<string>) =>
  [...skips].filter(([name]) => casePaths.has(cases.get(R.caseBaseName(name)) ?? "")).map(([name, reason]) => `${name}\t${reason}`);

describe("pinned corpus", () => {
  test("the directories hold the cases, the baselines and the lists of the pinned commits", () => {
    expect({
      cases: cases.size,
      tsBaselines: corpus.ts.size,
      tsgoBaselines: { compiler: corpus.tsgo.get("compiler").size, conformance: corpus.tsgo.get("conformance").size },
      expectsNoErrors: corpus.expectsNoErrors.size,
      accepted: corpus.accepted.size,
      triaged: corpus.triaged.size,
      postEmitOrder: corpus.postEmitOrder.size,
    }).toEqual({
      cases: pins.corpus.cases,
      tsBaselines: pins.corpus.tsBaselines,
      tsgoBaselines: pins.corpus.tsgoBaselines,
      expectsNoErrors: pins.corpus.expectsNoErrors,
      accepted: pins.corpus.accepted,
      triaged: pins.corpus.triaged,
      postEmitOrder: pins.corpus.postEmitOrder,
    });
    expect(readFileSync(home + "/UPSTREAM", "utf8")).toContain(`commit typescript-go ${pins.upstream["typescript-go"]}\n`);
    expect(readFileSync(home + "/UPSTREAM", "utf8")).toContain(`commit TypeScript ${pins.upstream.TypeScript}\n`);
  });

  test.skipIf(small)("every file of the corpus has the bytes of the pinned commits", () => {
    const paths: string[] = [];
    const walk = (dir: string, rel: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (rel === "" && entry.name.startsWith(".")) continue;
        const p = rel === "" ? entry.name : rel + "/" + entry.name;
        if (entry.isDirectory()) walk(dir + "/" + entry.name, p);
        else paths.push(p);
      }
    };
    walk(c, "");
    paths.sort(compareStrings);
    const listing = createHash("sha256");
    let bytes = 0;
    for (const p of paths) {
      const b = readFileSync(c + "/" + p);
      bytes += b.length;
      listing.update(`${p}\t${b.length}\t${sha(b)}\n`);
    }
    expect({ files: paths.length, bytes, sha256: listing.digest("hex") }).toEqual({
      files: pins.corpus.files,
      bytes: pins.corpus.bytes,
      sha256: pins.corpus.sha256,
    });
  });
});

describe.skipIf(!compact)("pinned enumeration", () => {
  test("the skip list is the pinned one", () => {
    expect({ rows: skips.size, sha256: sha(skipsText) }).toEqual(pins.skips);
    expect(pins.buckets.rows.length).toBe(pins.buckets.of);
  });

  // About 48 cases each: a debug build gets through one bucket within the time of one test.
  test.each([0, 1, 2, 3, 4, 5, 6, 7])("the cases of bucket %d: counts, digest and skips", k => {
    const sample = [...cases.values()].filter(p => bucketOf(p) === k).sort();
    const facts = sample.flatMap(p => R.enumerateCase(layout.casesRoot, p)).map((i: any) => R.factsOf(corpus, i));
    expect(facts.filter(f => f.status === "skipped").map(f => `${f.name}\t${f.reason}`).sort()).toEqual(skipsOf(new Set(sample)).sort());
    expect(bucketRow(k, facts)).toEqual(pins.buckets.rows[k]);
  });

  // One second of work in a release build, minutes in a debug build; the time limit is for a machine under load.
  test.skipIf(small)(
    "every case: counts, digests, skips and oracles",
    () => {
      const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
      const facts: any[] = e.instances.map((i: any) => R.factsOf(corpus, i));
      const n = (f: (x: any) => boolean) => facts.filter(f).length;
      const skipped = facts.filter(f => f.status === "skipped");
      // Name by name first: a difference reads as the instances it is about.
      expect(skipped.map(f => `${f.name}\t${f.reason}`).sort()).toEqual([...skips].map(([name, reason]) => `${name}\t${reason}`).sort());
      const reasons: Record<string, number> = {};
      for (const f of skipped) {
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
        skipped: skipped.length,
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
      expect({
        subtests: digestOf(e.instances.map((i: any) => `${i.status === "run" ? "PASS" : i.status === "skipped" ? "SKIP" : i.status}\t${i.testName.replaceAll(" ", "_")}\n`)),
        names: digestOf(facts.map(f => `${f.name}\n`)),
        status: digestOf(facts.map(f => `${f.name}\t${f.status}\t${f.reason}\n`)),
        kinds: digestOf(facts.filter(f => f.status === "run").map(f => `${f.name}\t${f.kind}\n`)),
        oracles: digestOf(oracleRows),
      }).toEqual(pins.digests);
      const rows = pins.buckets.rows.map((_: unknown, k: number) => bucketRow(k, facts.filter(f => bucketOf(f.casePath) === k)));
      expect(rows).toEqual(pins.buckets.rows);
    },
    30_000,
  );
});
