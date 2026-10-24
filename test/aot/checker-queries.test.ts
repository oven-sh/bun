// What the checker answers the compiler, as text. An expectation is a set of lines, because the whole text of a file is not written by hand.
// Consecutive `ordered:` lines must also be printed in that order. Other printed lines may come between them.
import { describeCheckerQueries } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { unpacked } from "./generate";
import { describe, test } from "./supported";

const fixtures = unpacked(join(import.meta.dir, "checker-queries"));
const extensions = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];

function textLines(path: string, commentPrefix: string): string[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter(line => line !== "" && !line.startsWith(commentPrefix));
}

function entryPointOf(expectation: string): string {
  const stem = join(fixtures, expectation.slice(0, -".queries.txt".length));
  const found = extensions.map(extension => `${stem}.${extension}`).filter(path => existsSync(path));
  expect(found).toHaveLength(1);
  return found[0];
}

// A subject can hold ` = ` itself, so the separator is the one after its closing backtick.
function separatorIndex(line: string): number {
  const afterSubject = line.indexOf("` = ");
  return afterSubject === -1 ? line.indexOf(" = ") : afterSubject + 1;
}

function leftOf(line: string): string {
  return line.slice(0, separatorIndex(line));
}

function answerOf(line: string): string {
  return line.slice(separatorIndex(line) + " = ".length);
}

function checkComparison(line: string, printed: string[]): string | undefined {
  const [kind, sides] = [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 2)];
  const answers: string[] = [];
  for (const left of sides.split(" <=> ")) {
    const matches = printed.filter(it => leftOf(it) === left);
    if (matches.length !== 1) return `${line}: ${left} occurs ${matches.length} times`;
    answers.push(answerOf(matches[0]));
  }
  if (answers.some(answer => answer.startsWith("gave up"))) return `${line}: ${answers.join(" <=> ")}`;
  const isEqual = answers[0] === answers[1];
  return isEqual === (kind === "same") ? undefined : `${line}: ${answers.join(" <=> ")}`;
}

function findFailures(expectation: string[], printed: string[]): string[] {
  const lines = new Set(printed);
  const failures: string[] = [];
  let orderedSearchStart = 0;
  for (const line of expectation) {
    if (line.startsWith("ordered: ")) {
      const text = line.slice("ordered: ".length);
      const index = printed.indexOf(text, orderedSearchStart);
      if (index !== -1) orderedSearchStart = index + 1;
      else failures.push(lines.has(text) ? `${line}: printed out of order` : line);
      continue;
    }
    orderedSearchStart = 0;
    if (line.startsWith("absent: ")) {
      if (lines.has(line.slice("absent: ".length))) failures.push(line);
    } else if (line.startsWith("same: ") || line.startsWith("different: ")) {
      const failure = checkComparison(line, printed);
      if (failure) failures.push(failure);
    } else if (!lines.has(line)) {
      failures.push(line);
    }
  }
  return failures;
}

type EarlyErrorCase = { text: string; name: string };

function importStatement(extension: string, index: number): string {
  const path = `./cases/${index}.${extension}`;
  return extension === "cjs" ? `require(${JSON.stringify(path)});\n` : `import ${JSON.stringify(path)};\n`;
}

function findRejected(cases: EarlyErrorCase[], extension: string): Set<number> {
  const tree: Record<string, string> = {
    "package.json": JSON.stringify({ type: "module" }),
    [`main.${extension}`]: cases.map((_, index) => importStatement(extension, index)).join(""),
  };
  cases.forEach(({ text }, index) => (tree[`cases/${index}.${extension}`] = text));
  using directory = tempDir("checker-queries-early-errors", tree);
  const printed = describeCheckerQueries(join(String(directory), `main.${extension}`), 0);
  const rejected = new Set<number>();
  for (const [, index] of printed.matchAll(/^cases\/(\d+)\.\w+:\d+ diagnostic TS\d+ = EarlyError /gm)) {
    rejected.add(Number(index));
  }
  return rejected;
}

function scanFixtures(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync(fixtures)].sort();
}

describe("checker queries", () => {
  test("`ordered:` lines fail when printed in another order", () => {
    const printed = ["a", "b", "c", "a"];
    expect(findFailures(["ordered: a", "ordered: c"], printed)).toEqual([]);
    expect(findFailures(["ordered: b", "ordered: a"], printed)).toEqual([]);
    expect(findFailures(["ordered: c", "ordered: b"], printed)).toEqual(["ordered: b: printed out of order"]);
    expect(findFailures(["ordered: c", "ordered: b", "ordered: a"], printed)).toEqual([
      "ordered: b: printed out of order",
    ]);
    expect(findFailures(["ordered: a", "ordered: d"], printed)).toEqual(["ordered: d"]);
    expect(findFailures(["ordered: c", "a", "ordered: b"], printed)).toEqual([]);
  });

  for (const expectation of scanFixtures("**/*.queries.txt")) {
    test.concurrent(expectation, () => {
      const entry = entryPointOf(expectation);
      const one = describeCheckerQueries(entry, 1);
      const eight = describeCheckerQueries(entry, 8);
      expect(eight).toBe(one);
      const failures = findFailures(textLines(join(fixtures, expectation), "#"), one.split("\n"));
      expect(failures).toEqual([]);
    });
  }
});

describe("early errors", () => {
  for (const file of scanFixtures("early-errors/*.{rejected,accepted}.*")) {
    test.concurrent(file, () => {
      const [, verdict, extension] = basename(file).match(/\.(rejected|accepted)\.(\w+)$/)!;
      const cases = textLines(join(fixtures, file), "//").map(line => ({
        name: line,
        text: line.replaceAll("⏎", "\n"),
      }));
      const rejected = findRejected(cases, extension);
      const isRejectionExpected = verdict === "rejected";
      const failures = cases.filter((_, index) => rejected.has(index) !== isRejectionExpected).map(it => it.name);
      expect(failures).toEqual([]);
    });
  }

  const test262 = process.env.TEST262_DIR;
  const BATCH_SIZE = 500;
  const ACCEPTED_SAMPLE_INTERVAL = 20;

  type Test262Case = EarlyErrorCase & { extension: string; isRejected: boolean };

  function frontMatterOf(source: string): string {
    return source.match(/\/\*---([\s\S]*?)---\*\//)?.[1] ?? "";
  }

  function flagsOf(frontMatter: string): string[] {
    const flags = frontMatter.match(/^flags:\s*\[([^\]]*)\]/m)?.[1] ?? "";
    return flags.split(",").map(flag => flag.trim());
  }

  function collectTest262Cases(root: string): Test262Case[] {
    const language = join(root, "test/language");
    const paths = [...new Bun.Glob("**/*.js").scanSync(language)].filter(path => !path.includes("_FIXTURE")).sort();
    const cases: Test262Case[] = [];
    let acceptedCandidates = 0;
    for (const path of paths) {
      const source = readFileSync(join(language, path), "utf8");
      const frontMatter = frontMatterOf(source);
      const flags = flagsOf(frontMatter);
      const isNegative = /^negative:/m.test(frontMatter);
      const isRejected = isNegative && /^\s+phase:\s*parse\s*$/m.test(frontMatter) && !flags.includes("raw");
      if (isNegative && !isRejected) continue;
      if (!isRejected && acceptedCandidates++ % ACCEPTED_SAMPLE_INTERVAL !== 0) continue;
      const extension = flags.includes("module") ? "mjs" : "cjs";
      const text = flags.includes("onlyStrict") ? `"use strict";\n${source}` : source;
      cases.push({ name: relative(root, join(language, path)), text, extension, isRejected });
    }
    return cases;
  }

  function findTest262Failures(cases: Test262Case[]): string[] {
    const failures: string[] = [];
    for (const extension of ["mjs", "cjs"]) {
      const sameExtension = cases.filter(it => it.extension === extension);
      for (let start = 0; start < sameExtension.length; start += BATCH_SIZE) {
        const batch = sameExtension.slice(start, start + BATCH_SIZE);
        const rejected = findRejected(batch, extension);
        batch.forEach((it, index) => {
          if (rejected.has(index) !== it.isRejected) failures.push(it.name);
        });
      }
    }
    return failures.sort();
  }

  test.skipIf(!test262)(
    "test262",
    () => {
      const known = textLines(join(fixtures, "early-errors/test262-known-failures.txt"), "#");
      expect(findTest262Failures(collectTest262Cases(test262!))).toEqual(known);
    },
    1_800_000,
  );
});
