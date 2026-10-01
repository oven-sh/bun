import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import * as runner from "./conformance/runner";

describe("corpus", () => {
  test("an instance that the reference fails is no skip: it does not run and its facts are invalid", () => {
    const both = "compiler/both.errors.txt.diff\n";
    using dir = tempDir("lint-conformance-corpus", {
      "cases/compiler/bad.ts": "// @target: nosuch,es2015\nvar x = 1;\n",
      "cases/compiler/both.ts": "var both = 1;\n",
      "cases/compiler/clean.ts": "var y = 1;\n",
      "cases/compiler/skipme.ts": "// @target: es5\nvar w = 1;\n",
      "cases/conformance": {},
      "baselines/typescript": {},
      "baselines/typescript-go/NO_ERRORS.txt": "",
      "submoduleAccepted.txt": both,
      "submoduleTriaged.txt": both,
    });
    const corpus = runner.openCorpus(String(dir));
    const inBoth =
      "diff file compiler/both.errors.txt.diff is in both submoduleAccepted and submoduleTriaged; it should only be in one";
    expect(
      corpus.enumerateInstances().map(i => {
        const facts = corpus.facts(i);
        return [i.name, i.status === "run", i.invalidReason, facts.status, facts.reason, facts.kind];
      }),
    ).toEqual([
      [
        "bad.ts",
        false,
        "Unknown value 'nosuch' for option 'target'",
        "invalid",
        "Unknown value 'nosuch' for option 'target'",
        undefined,
      ],
      ["both.ts", false, inBoth, "invalid", inBoth, undefined],
      ["clean.ts", true, undefined, "run", "", "C"],
      ["skipme.ts", false, undefined, "skipped", "unsupported target ES5", undefined],
    ]);
  });
});
