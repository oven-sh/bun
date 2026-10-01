import { describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import * as runner from "./conformance/runner";

describe("corpus", () => {
  test("an instance that the reference fails does not run, and no list may hold it", () => {
    const both = "compiler/both.errors.txt.diff\ncompiler/skipped.errors.txt.diff\n";
    using dir = tempDir("lint-conformance-corpus", {
      "cases/compiler/before.ts": "let a = 1;\n// @filename: b.ts\nlet b = 2;\n",
      "cases/compiler/both.ts": "let z = 1;\n",
      "cases/compiler/clean.ts": "let y = 1;\n",
      "cases/compiler/skipped.ts": "// @target: es5\nlet w = 1;\n",
      "cases/conformance": {},
      "baselines/typescript": {},
      "baselines/typescript-go/NO_ERRORS.txt": "",
      "submoduleAccepted.txt": both,
      "submoduleTriaged.txt": both,
    });
    const corpus = runner.openCorpus(String(dir));
    const inBoth = "diff file compiler/both.errors.txt.diff is in both submoduleAccepted and submoduleTriaged";
    expect(
      corpus.enumerateInstances().map(i => {
        const facts = corpus.facts(i);
        return [i.name, i.status, i.skipReason ?? "", facts.status, facts.kind ?? ""];
      }),
    ).toEqual([
      [
        "before.ts",
        "skip",
        "invalid: Non-comment test content appears before the first '// @Filename' directive",
        "invalid",
        "",
      ],
      ["both.ts", "skip", `invalid: ${inBoth}; it should only be in one`, "invalid", ""],
      ["clean.ts", "run", "", "run", "C"],
      ["skipped.ts", "skip", "unsupported target ES5", "skipped", ""],
    ]);
    expect(corpus.cases()).toEqual([
      "compiler/before.ts",
      "compiler/both.ts",
      "compiler/clean.ts",
      "compiler/skipped.ts",
    ]);
    expect(corpus.caseOf("clean(strict=true).ts")).toBe("compiler/clean.ts");
    expect(corpus.caseOf("noSuchCase.ts")).toBeUndefined();
  });

  test("a corpus that cannot be read says so", () => {
    using dir = tempDir("lint-conformance-corpus", { "cases/compiler/a.ts": "", "cases/conformance/a.ts": "" });
    const corpus = runner.openCorpus(String(dir));
    expect(() => corpus.caseOf("a.ts")).toThrow(
      "the corpus has two cases of one name: compiler/a.ts and conformance/a.ts",
    );
    expect(() => corpus.load()).toThrow(runner.CorpusError);
    expect(() => runner.openCorpus(String(dir) + "/none").load()).toThrow("cannot be read");
  });
});
