// The same candidate for the binding that keeps the two statuses of run.ts (../../runner-corpus-binding/top-down/corpus.ts): an
// instance that the reference fails has the status "skip", a skipReason that says so, and its invalidReason.
import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import * as runner from "./conformance/runner";
import { emptyCheck, runInstances } from "./conformance/runner";

describe("corpus", () => {
  test("an instance that the reference fails is told from one that it skips, and neither runs", async () => {
    const both = "compiler/both.errors.txt.diff\n";
    using dir = tempDir("lint-conformance-corpus", {
      "cases/compiler/bad.ts": "// @target: nosuch,es2015\nvar a = 1;\n",
      "cases/compiler/both.ts": "var b = 1;\n",
      "cases/compiler/clean.ts": "var c = 1;\n",
      "cases/compiler/skipped.ts": "// @target: es5\nvar d = 1;\n",
      "cases/conformance": {},
      "baselines/typescript": {},
      "baselines/typescript-go/NO_ERRORS.txt": "",
      "submoduleAccepted.txt": both,
      "submoduleTriaged.txt": both,
    });
    const corpus = runner.openCorpus(String(dir));
    const instances = corpus.enumerateInstances();
    const unknown = "Unknown value 'nosuch' for option 'target'";
    const inBoth =
      "diff file compiler/both.errors.txt.diff is in both submoduleAccepted and submoduleTriaged; it should only be in one";
    expect(instances.map(i => [i.name, i.status, i.skipReason, i.invalidReason])).toEqual([
      ["bad.ts", "skip", `the reference fails the instance: ${unknown}`, unknown],
      ["both.ts", "skip", `the reference fails the instance: ${inBoth}`, inBoth],
      ["clean.ts", "run", undefined, undefined],
      ["skipped.ts", "skip", "unsupported target ES5", undefined],
    ]);
    expect(instances.map(i => corpus.facts(i)).map(f => [f.status, f.reason, f.kind])).toEqual([
      ["invalid", unknown, undefined],
      ["invalid", inBoth, undefined],
      ["run", "", "C"],
      ["skipped", "unsupported target ES5", undefined],
    ]);
    expect(corpus.enumerateCase("compiler/both.ts")).toEqual([instances[1]]);
    const results = await runInstances(instances, emptyCheck, { input: corpus.input, oracle: corpus.oracle });
    expect(results.map(r => [r.instance.name, r.outcome, r.reason])).toEqual([
      ["bad.ts", "skip", `the reference fails the instance: ${unknown}`],
      ["both.ts", "skip", `the reference fails the instance: ${inBoth}`],
      ["clean.ts", "pass", ""],
      ["skipped.ts", "skip", "unsupported target ES5"],
    ]);
  });
});
