import { expect } from "bun:test";
import { basename, join } from "node:path";
import { findRejected, foldersOf, textLines, unpackFolders } from "./checker-queries";
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
});
