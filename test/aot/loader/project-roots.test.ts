import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree } from "./describe";

const projectFiles: DirectoryTree = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      noEmit: true,
      types: [],
    },
    include: ["src", "types"],
  }),
  "src/main.ts": 'import "./used.ts";\nconsole.log(BUILD_ID);',
  "src/used.ts": "export {};",
  "types/globals.d.ts": "declare const BUILD_ID: string;",
  "src/main.test.ts": 'import { helper } from "./test-helper.ts";\nimport "test-only-package";\nhelper();',
  "src/test-helper.ts": "export function helper() {}",
  "node_modules/test-only-package/package.json": JSON.stringify({
    name: "test-only-package",
    version: "1.0.0",
    main: "index.js",
  }),
  "node_modules/test-only-package/index.js": "export {};",
};

test("root files are loaded and not compiled", () => {
  using graph = describeTree(projectFiles, ["src/main.ts"]);

  expect(graph.file("types/globals.d.ts").role).toBe("TypesOnly");
  expect(graph.file("src/main.test.ts")).toMatchObject({
    role: "Checked",
    isCompiled: false,
    codeEdges: [],
    sites: [],
  });
  expect(graph.file("src/test-helper.ts")).toMatchObject({ role: "Checked", isCompiled: false });
  expect(graph.has("node_modules/test-only-package/index.js")).toBe(false);
  expect(graph.compiledFiles).toEqual(["src/used.ts", "src/main.ts"]);
});

test("an entry point outside include", () => {
  using graph = describeTree({ ...projectFiles, "scripts/tool.ts": "export {};" }, ["scripts/tool.ts"]);

  expect(graph.file("scripts/tool.ts")).toMatchObject({ role: "Checked", isCompiled: true });
  expect(graph.has("types/globals.d.ts")).toBe(true);
  expect(graph.compiledFiles).toEqual(["scripts/tool.ts"]);
});

test("without a tsconfig.json only what is reached is loaded", () => {
  using graph = describeTree(
    {
      "main.ts": "export {};",
      "unrelated.ts": "export {};",
      "globals.d.ts": "declare const BUILD_ID: string;",
    },
    ["main.ts"],
  );

  expect(graph.paths).toEqual(["main.ts"]);
});
