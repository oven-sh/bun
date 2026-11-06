import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { findRejected, foldersOf, textLines, unpackFolders, type EarlyErrorCase } from "./checker-queries";
import { describe, test } from "./with-compiler";

const fixtures = unpackFolders(foldersOf["early-errors"]);

describe("early errors", () => {
  for (const file of [...new Bun.Glob("early-errors/*.{rejected,accepted}.*").scanSync(fixtures)].sort()) {
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
