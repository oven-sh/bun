import { expect } from "bun:test";
import type { DirectoryTree } from "harness";
import { test } from "../supported";
import { describeTree } from "./describe";

type JsxCase = [name: string, configuration: DirectoryTree, entryPoint: string, text: string, runtime: string | null];

const element = "export const element = <div />;";
const withPragma = (pragma: string) => `/** ${pragma} */\n${element}`;

const tsconfig = (compilerOptions: object, directory = ""): DirectoryTree => ({
  [`${directory}tsconfig.json`]: JSON.stringify({ compilerOptions }),
});

const jsxPackage = (name: string): DirectoryTree => ({
  "package.json": JSON.stringify({ name, version: "1.0.0", main: "./index.js" }),
  "index.js": "export {};",
  "jsx-runtime.js": "export {};",
  "jsx-dev-runtime.js": "export {};",
});
const packages: DirectoryTree = {
  "node_modules/react": jsxPackage("react"),
  "node_modules/preact": jsxPackage("preact"),
};

const development = (name: string) => `${name}/jsx-dev-runtime`;
const production = (name: string) => `${name}/jsx-runtime`;

const cases: JsxCase[] = [
  ["no configuration", {}, "main.tsx", element, development("react")],
  ["an inferred file", {}, "main.jsx", element, development("react")],
  ["react-jsx", tsconfig({ jsx: "react-jsx" }), "main.tsx", element, production("react")],
  ["react-jsxdev", tsconfig({ jsx: "react-jsxdev" }), "main.tsx", element, development("react")],
  ["classic", tsconfig({ jsx: "react" }), "main.tsx", element, null],
  ["preserve is ignored", tsconfig({ jsx: "preserve" }), "main.tsx", element, development("react")],
  [
    "development mode is per build",
    tsconfig({ jsx: "react-jsx" }, "sub/"),
    "sub/main.tsx",
    element,
    development("react"),
  ],
  ["the runtime is per file", tsconfig({ jsx: "react" }, "sub/"), "sub/main.tsx", element, null],
  [
    "jsxImportSource",
    tsconfig({ jsx: "react-jsx", jsxImportSource: "preact" }),
    "main.tsx",
    element,
    production("preact"),
  ],
  ["@jsxImportSource", {}, "main.tsx", withPragma("@jsxImportSource preact"), development("preact")],
  [
    "@jsxImportSource overrides the configuration",
    tsconfig({ jsx: "react-jsx", jsxImportSource: "react" }),
    "main.tsx",
    withPragma("@jsxImportSource preact"),
    production("preact"),
  ],
  ["@jsxRuntime classic", {}, "main.tsx", withPragma("@jsxRuntime classic"), null],
  [
    "@jsxRuntime automatic",
    tsconfig({ jsx: "react" }),
    "main.tsx",
    withPragma("@jsxRuntime automatic"),
    development("react"),
  ],
  ["@jsx does not change the runtime", {}, "main.tsx", withPragma("@jsx h"), development("react")],
  ["@jsxFrag does not change the runtime", {}, "main.tsx", withPragma("@jsxFrag Fragment"), development("react")],
  [
    "JSX only in dead code",
    {},
    "main.tsx",
    "export const element = false ? <div /> : null;\nif (false) { console.log(<span />); }",
    null,
  ],
  ["no JSX", {}, "main.tsx", "export const n = 1;", null],
  ["a .ts file", {}, "main.ts", "export const n = <number>1;", null],
];

test.each(cases)("%s", (_, configuration, entryPoint, text, runtime) => {
  using graph = describeTree({ ...packages, ...configuration, [entryPoint]: text }, [entryPoint]);
  const followedFiles = runtime ? [`node_modules/${runtime}.js`] : [];
  expect(graph.file(entryPoint).sites.map(({ specifier, kind, answer }) => ({ specifier, kind, answer }))).toEqual(
    runtime ? [{ specifier: runtime, kind: "import", answer: followedFiles[0] }] : [],
  );
  expect(graph.compiledFiles).toEqual([...followedFiles, entryPoint]);
});

test("the file's own imports come after the JSX import", () => {
  const files = { ...packages, "main.tsx": `import "./own.ts";\n${element}`, "own.ts": "export {};" };
  using graph = describeTree(files, ["main.tsx"]);
  expect(graph.file("main.tsx")).toMatchObject({
    codeEdges: ["node_modules/react/jsx-dev-runtime.js", "own.ts"],
    sites: [
      { specifier: "react/jsx-dev-runtime", kind: "import", answer: "node_modules/react/jsx-dev-runtime.js" },
      { specifier: "./own.ts", kind: "import", answer: "own.ts" },
    ],
  });
});

test("not installed", () => {
  using graph = describeTree({ "main.tsx": element }, ["main.tsx"]);
  expect(graph.file("main.tsx").sites).toMatchObject([
    { specifier: "react/jsx-dev-runtime", kind: "import", answer: "not found (ModuleNotFound)" },
  ]);
  expect(graph.compiledFiles).toEqual(["main.tsx"]);
});
