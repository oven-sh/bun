// Prototype of the blocks of test/cli/lint/conformance.test.ts that read the committed ground truth of this unit.
// In the repository: "harness" for the absolute import, "./conformance/runner" for the runner, join(import.meta.dir, "conformance") for the directory.
// usage: CGT_ASM=<assembled runner set> CGT_HOME=<conformance directory with corpus/, fixtures/, reference_counts.json, UPSTREAM> bun test <this file>
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { isASAN, isDebug } from "/workspace/wt/conformance/test/harness.ts";

const asm = process.env.CGT_ASM!;
const home = process.env.CGT_HOME!;
const runner = asm + "/test/cli/lint/conformance/runner/";
const R = await import(runner + "index.ts");
const G = await import(runner + "gostrings.ts");
const S = await import(runner + "stringutil.ts");
const B = await import(runner + "baseline.ts");
const H = await import(runner + "harnessutil.ts");

const small = isDebug || isASAN;
const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const sampled = (path: string, n: number) => Bun.hash.crc32(path) % n === 0;
const layout = {
  casesRoot: home + "/corpus/ts/tests/cases",
  libRoot: home + "/corpus/ts/tests/lib",
  tsgoBaselines: home + "/corpus/tsgo/testdata/baselines/reference/submodule",
  tsBaselines: home + "/corpus/ts/tests/baselines/reference",
  expectsNoErrors: home + "/corpus/tsgo.expects-no-errors.txt",
  accepted: home + "/corpus/tsgo/testdata/submoduleAccepted.txt",
  triaged: home + "/corpus/tsgo/testdata/submoduleTriaged.txt",
  postEmitOrder: asm + "/test/cli/lint/conformance/post-emit-order.txt",
};

const reference = JSON.parse(readFileSync(home + "/reference_counts.json", "utf8"));
const listText = readFileSync(process.env.CGT_LIST ?? home + "/fixtures/instances.tsv", "utf8");
const listLines = listText.split("\n").slice(0, -1);
const lineOfName = new Map(listLines.map(l => [l.slice(0, l.indexOf("\t")), l]));
const lineOf = (f: any): string => (f.status === "run" ? `${f.name}\t${f.kind}` : `${f.name}\t${f.status}\t${f.reason}`);
const goName = (name: string) => {
  const m = /^(.*)\(([^()]*)\)(\.tsx?)$/s.exec(name);
  return m === null ? name : `${m[1]}${m[3]}_${m[2]}`;
};
let corpusOnce: any;
const corpus = () => (corpusOnce ??= R.loadCorpus(layout));

describe("reference", () => {
  test("the constants are those of the commits that UPSTREAM names", () => {
    const upstream = readFileSync(home + "/UPSTREAM", "utf8");
    const commit = (repository: string) => new RegExp(`^commit ${repository} ([0-9a-f]{40})$`, "m").exec(upstream)?.[1];
    expect({ "typescript-go": commit("typescript-go"), TypeScript: commit("TypeScript") }).toEqual(reference.upstream);
    // A run of the reference's suite is evidence for one commit: a member of another commit has to be removed, not skipped.
    if (reference.suiteRun !== undefined) expect(reference.suiteRun["typescript-go"]).toBe(reference.upstream["typescript-go"]);
  });

  test("the list of instances is the pinned one", () => {
    expect(sha256(listText)).toBe(reference.instances.sha256);
    const count = (status: string) => listLines.filter(l => l.split("\t")[1] === status).length;
    const reasons: Record<string, number> = {};
    for (const l of listLines) {
      const [, status, reason] = l.split("\t");
      if (status !== "skipped") continue;
      const key = reason.replace(/^(unsupported (?:baseUrl|outFile)) .*/, "$1");
      reasons[key] = (reasons[key] ?? 0) + 1;
    }
    expect({ all: listLines.length, names: lineOfName.size, E: count("E"), C: count("C"), skipped: count("skipped"), invalid: count("invalid"), reasons }).toEqual({
      all: reference.instances.all,
      names: reference.instances.all,
      E: reference.instances.E,
      C: reference.instances.C,
      skipped: reference.instances.skipped,
      invalid: reference.instances.invalid,
      reasons: reference.instances.skippedBecause,
    });
    expect(reference.instances.run).toBe(reference.instances.E + reference.instances.C);
  });

  test("the declared options", () => {
    expect({ declared: H.optionsDeclarations.length, varying: H.getCompilerVaryByMap().size }).toEqual(reference.options);
  });

  test("the case and space tables are those of Go", () => {
    const parts: Record<string, string[]> = { lower: [], foldKey: [], space: [], white: [] };
    for (let r = 0; r <= 0x10ffff; r++) {
      const l = G.unicodeToLower(r);
      if (l !== r) parts.lower.push(`${r.toString(16)} ${l.toString(16)}\n`);
      const k = G.foldKey(r);
      if (k !== r) parts.foldKey.push(`${r.toString(16)} ${k.toString(16)}\n`);
      if (G.isSpace(r)) parts.space.push(`${r.toString(16)}\n`);
      if (S.isWhiteSpaceLike(r)) parts.white.push(`${r.toString(16)} ${S.isWhiteSpaceSingleLine(r)} ${S.isLineBreak(r)}\n`);
    }
    expect(Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, sha256(v.join(""))]))).toEqual(reference.go.tables);
  });

  const sample = [...R.indexCases(layout.casesRoot).values()].filter((p: any) => sampled(p, 40)).sort() as string[];
  const groups: string[][] = [];
  for (let k = 0; k < sample.length; k += 40) groups.push(sample.slice(k, k + 40));
  test("the sample holds cases", () => {
    expect(sample.length).toBeGreaterThan(200);
  });
  test.each(groups.map((g, k) => [k + 1, g] as const))("the instances of one of 40 cases are their lines of the list: group %d", (_k, group) => {
    const got: string[] = [];
    const want: string[] = [];
    for (const path of group) {
      for (const i of R.enumerateCase(layout.casesRoot, path)) {
        const f = R.factsOf(corpus(), i);
        got.push(lineOf(f));
        want.push(lineOfName.get(f.name) ?? `${f.name}\tno line`);
      }
    }
    expect(got).toEqual(want);
  });

  test.skipIf(small)(
    "every instance is its line of the list, and the counts are the pinned ones",
    () => {
      const c = corpus();
      const e = R.enumerateInstances({ casesRoot: layout.casesRoot });
      const facts: any[] = e.instances.map((i: any) => R.factsOf(c, i));
      const suiteOf = new Map<string, string>(e.instances.map((i: any) => [i.name, i.suite]));
      const got = facts.map(lineOf).sort((a, b) => R.compareNames(a.slice(0, a.indexOf("\t")), b.slice(0, b.indexOf("\t"))));
      // The names that differ, not two lists of 14,915 lines.
      const gotSet = new Set(got);
      const wantSet = new Set(listLines);
      expect({ notInTheList: got.filter(l => !wantSet.has(l)).slice(0, 20), notEnumerated: listLines.filter(l => !gotSet.has(l)).slice(0, 20) }).toEqual({ notInTheList: [], notEnumerated: [] });
      expect(got.join("\n") + "\n").toBe(listText);
      const count = (f: (x: any) => boolean) => facts.filter(f).length;
      const suite = (s: string) => {
        const of = (f: (x: any) => boolean) => count(x => suiteOf.get(x.name) === s && f(x));
        return { instances: of(() => true), run: of(x => x.status === "run"), skipped: of(x => x.status === "skipped"), E: of(x => x.kind === "E"), C: of(x => x.kind === "C") };
      };
      const sources: Record<string, number> = { "typescript-go": 0, typescript: 0, "expects-no-errors": 0, none: 0 };
      for (const i of e.instances) if (i.status === "run") sources[B.oracleOf(c, i.suite, i.name).source]++;
      expect({
        cases: { files: e.files, droppedByName: e.droppedBySkippedTests.length },
        compiler: suite("compiler"),
        conformance: suite("conformance"),
        accepted: count(x => x.tags.includes("accepted")),
        triaged: count(x => x.tags.includes("triaged")),
        postEmitOrder: count(x => x.tags.includes("post-emit-order")),
        pretty: e.instances.filter((i: any, k: number) => facts[k].kind === "E" && ((i.config?.get("pretty") ?? "") as string).toLowerCase() === "true").length,
        oracle: sources,
      }).toEqual({
        cases: { files: reference.cases.files, droppedByName: reference.cases.droppedByName },
        compiler: reference.instances.compiler,
        conformance: reference.instances.conformance,
        accepted: reference.instances.accepted,
        triaged: reference.instances.triaged,
        postEmitOrder: reference.instances.postEmitOrder,
        pretty: reference.instances.pretty,
        oracle: reference.oracle,
      });
      if (reference.suiteRun !== undefined) {
        const subtests = facts
          .map(f => `${f.status === "run" ? "PASS" : "SKIP"}\t${goName(f.name)}`)
          .sort((a, b) => G.compareStrings(a.slice(5), b.slice(5)))
          .map(l => l + "\n")
          .join("");
        const reasons = facts
          .filter(f => f.status === "skipped")
          .map(f => `${goName(f.name)}\t${f.reason}`)
          .sort(G.compareStrings)
          .map(l => l + "\n")
          .join("");
        expect({ subtests: facts.length, sha256: sha256(subtests), skipReasonsSha256: sha256(reasons) }).toEqual({
          subtests: reference.suiteRun.subtests,
          sha256: reference.suiteRun.sha256,
          skipReasonsSha256: reference.suiteRun.skipReasonsSha256,
        });
      }
    },
    30_000,
  );

  test.skipIf(small)(
    "the corpus on disk is the committed corpus",
    () => {
      const files: string[] = [];
      const walk = (dir: string, rel: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.isDirectory()) walk(dir + "/" + entry.name, rel + entry.name + "/");
          else files.push(rel + entry.name);
        }
      };
      walk(home + "/corpus", "");
      files.sort(G.compareStrings);
      const h = createHash("sha256");
      let bytes = 0;
      for (const f of files) {
        const b = readFileSync(home + "/corpus/" + f);
        bytes += b.length;
        h.update(`${createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex")} ${f}\n`);
      }
      expect({ files: files.length, bytes, sha256: h.digest("hex") }).toEqual({ files: reference.corpus.files, bytes: reference.corpus.bytes, sha256: reference.corpus.sha256 });
    },
    30_000,
  );
});
