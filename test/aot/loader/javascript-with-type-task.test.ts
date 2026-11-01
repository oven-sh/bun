import { expect } from "bun:test";
import { test } from "../with-compiler";
import { describeTree } from "./describe";

// No tsconfig.json: the default options have `strict` and `allowJs`. The code tasks of feature.ts and util.js are queued
// together, so the type task that feature.ts starts for util.js runs between them.
const files = {
  "index.js": 'import { feature } from "./feature.ts";\nimport { g } from "./util.js";\nconsole.log(feature, g());\n',
  "feature.ts": 'import { g } from "./util.js";\nexport const feature: number = g();\n',
  "util.js": "let calls = 0;\nexport function g() {\n  return ++calls;\n}\n",
};

test("JavaScript that a code task and a type task load keeps its type edge", () => {
  using graph = describeTree(files, ["index.js"]);

  expect(graph.diagnostics).toEqual([]);
  expect(graph.file("util.js").role).toBe("Inferred");
  expect(graph.file("feature.ts")).toMatchObject({ role: "Checked", typeEdges: ["util.js"], codeEdges: ["util.js"] });
  expect(graph.compiledFiles).toEqual(["util.js", "feature.ts", "index.js"]);
});
