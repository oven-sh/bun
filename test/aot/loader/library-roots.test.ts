import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree } from "./describe";

const mainText = 'if (import.meta.main) require("./main-is-entry.ts"); else require("./main-is-imported.ts");';

const files: DirectoryTree = {
  "main.ts": mainText,
  "library.ts": [
    "export function helper() {}",
    'if (import.meta.main) require("./library-is-entry.ts"); else require("./library-is-imported.ts");',
  ].join("\n"),
  "main-is-entry.ts": "export {};",
  "main-is-imported.ts": "export {};",
  "library-is-entry.ts": "export {};",
  "library-is-imported.ts": "export {};",
};

test("two entry points", () => {
  using graph = describeTree(files, ["main.ts", "library.ts"]);

  expect(graph.entryPoints).toEqual(["main.ts", "library.ts"]);
  expect(graph.compiledFiles).toEqual([
    "main-is-entry.ts",
    "main-is-imported.ts",
    "main.ts",
    "library-is-entry.ts",
    "library-is-imported.ts",
    "library.ts",
  ]);
});
