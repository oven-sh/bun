// A candidate for describe("reference") of test/cli/lint/conformance.test.ts, as a file of its own so that it can be run alone:
// copy it to test/cli/lint/zz-corpus-names.test.ts of a clone that has the corpus, and run `bun test ./test/cli/lint/zz-corpus-names.test.ts`.
// In conformance.test.ts the constants corpusRoot and small are there already, and cases() walks the same directories: the test is new,
// with basename and sep added to the import of node:path. It reads corpus/cases and corpus/lib once more: 11 ms in a release build.
import { expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join, sep } from "node:path";

const corpusRoot = join(import.meta.dir, "conformance", "corpus");
const small = isDebug || isASAN;

// Every file below the cases and the test library, from the names of the directories alone: the only files of the corpus with a JavaScript-like extension.
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(`${corpusRoot}/${rel}`, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${rel}/${entry.name}`);
      else out.push(`${rel}/${entry.name}`);
    }
  };
  walk("cases");
  walk("lib");
  return out;
}

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
  const isTest: (path: string) => boolean = new Function(
    "basename",
    "sep",
    "isCI",
    "isMacOS",
    "isX64",
    `${code}\nreturn isTest;`,
  )(basename, sep, false, false, false);
  // The path as the runner has it: below test/, with the separator of the platform.
  const prefix = join("cli", "lint", "conformance", "corpus") + sep;
  const below = (path: string) => prefix + (sep === "/" ? path : path.replaceAll("/", sep));
  expect(isTest(join("cli", "lint", "conformance.test.ts"))).toBe(true);
  expect(isTest(below("cases/compiler/a.test.ts"))).toBe(true);
  expect(isTest(below("cases/conformance/js/node/test/parallel/a.ts"))).toBe(true);
  const started = performance.now();
  const all = sourceFiles();
  const walked = performance.now();
  // A debug or sanitizer build takes every fortieth name, by its place and not by a hash, which costs it more than the rule: a release build takes them all.
  const files = small ? all.filter((_, i) => i % 40 === 0) : all;
  expect(files.filter(path => isTest(below(path)))).toEqual([]);
  expect(all.length).toBeGreaterThan(12000);
  console.log(
    `walk of ${all.length} names ${(walked - started).toFixed(0)} ms, rule on ${files.length} names ${(performance.now() - walked).toFixed(0)} ms`,
  );
});
