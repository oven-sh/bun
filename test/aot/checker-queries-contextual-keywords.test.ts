import { expect } from "bun:test";
import { findRejected } from "./checker-queries";
import { casesOf, words } from "./contextual-keywords-as-names-cases";
import { describe, test } from "./with-compiler";

describe("a word that has a meaning in some places is a name in the others", () => {
  for (const word of words) {
    test(
      word,
      () => {
        const cases = casesOf(word);
        for (const directive of ["", "// @ts-nocheck\n"]) {
          const rejected = findRejected(
            cases.map(it => ({ ...it, text: directive + it.text })),
            "ts",
          );
          const failures = cases.filter((it, index) => rejected.has(index) !== it.isRejected).map(it => it.name);
          expect({ directive, failures }).toEqual({ directive, failures: [] });
        }
      },
      120_000,
    );
  }
});
