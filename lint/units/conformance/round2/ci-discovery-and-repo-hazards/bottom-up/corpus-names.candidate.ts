// A candidate for describe("reference") of test/cli/lint/conformance.test.ts, as a file of its own so that it can be run alone:
// copy it to test/cli/lint/zz-corpus-names.test.ts of a clone that has the corpus, and run `bun test ./test/cli/lint/zz-corpus-names.test.ts`.
import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, sep } from "node:path";

// The rule by which the runner of CI takes a file below test/ for a test, cut out of its source the way comment-cop.test.ts cuts the script out of its workflow.
test("no file of the corpus is a test file for the runner of CI", () => {
  const source = readFileSync(join(import.meta.dir, "../../../scripts/runner.node.ts"), "utf8");
  const cut = (name: string) => {
    const found = new RegExp(`^function ${name}\\([^]*?^}$`, "m").exec(source);
    if (found === null) throw new Error(`scripts/runner.node.ts has no function ${name}`);
    return found[0];
  };
  const code = new Bun.Transpiler({ loader: "ts" }).transformSync(
    ["isJavaScript", "isNodeTest", "isClusterTest", "isTest", "isTestStrict"].map(cut).join("\n"),
  );
  const isTest: (path: string) => boolean = new Function("basename", "sep", "isCI", "isMacOS", "isX64", `${code}\nreturn isTest;`)(
    basename,
    sep,
    false,
    false,
    false,
  );
  expect(isTest(join("cli", "lint", "conformance.test.ts"))).toBe(true);
  expect(isTest(join("cli", "lint", "conformance", "corpus", "cases", "compiler", "a.test.ts"))).toBe(true);
  const taken: string[] = [];
  let seen = 0;
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(import.meta.dir, rel), { withFileTypes: true })) {
      const path = join(rel, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        seen++;
        if (isTest(join("cli", "lint", path))) taken.push(path);
      }
    }
  };
  walk(join("conformance", "corpus"));
  expect(taken).toEqual([]);
  expect(seen).toBeGreaterThan(20000);
});
