import { test } from "bun:test";

// Each file imports "assert" or "should" from "vitest" beside what makes it CommonJS. It loads, or its import is refused at a line.
const rows = [
  "after-unused.ts",
  "attribute.ts",
  "before-another.ts",
  "both-used.js",
  "both-used.ts",
  "default-name-only.ts",
  "default-name-unused.ts",
  "default-name-used.js",
  "default-name-used.ts",
  "default-name.ts",
  "empty-clause.ts",
  "export-equals.ts",
  "exports.ts",
  "line3-chai.ts",
  "line3.ts",
  "no-names.ts",
  "other-name-unused.ts",
  "other-name.ts",
  "renamed.ts",
  "requires-chai.ts",
  "should.ts",
  "two-statements.ts",
  "type-only.ts",
  "type-sibling.ts",
  "unused.cts",
  "unused.js",
  "unused.ts",
  "unused.tsx",
  "used.ts",
  "vi-used.ts",
];

// Without --aot the error says the line in `position`. With it, the message ends with the line and the column.
const lineOf = error => /\((\d+):\d+\)$/.exec(String(error.message).split("\n")[0])?.[1] ?? error.position?.line;

test("by require", () => {
  for (const file of rows) {
    try {
      console.log("require", file, require("./" + file).check(true) ?? "checked");
    } catch (error) {
      console.log("require", file, "refused at line", String(lineOf(error)));
    }
  }
});

test("by import", async () => {
  for (const file of rows) {
    try {
      const loaded = await import("./" + file);
      console.log("import", file, (loaded.default ?? loaded).check(true) ?? "checked");
    } catch (error) {
      console.log("import", file, "refused at line", String(lineOf(error)));
    }
  }
});
