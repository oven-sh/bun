import { afterAll, expect } from "bun:test";
import { bunExe, tempDir, type DirectoryTree } from "harness";
import { linesOf, tsc } from "../../cli/check/differential";
import { endChildren } from "../../cli/children";
import { test } from "../supported";
import { describeDirectory, type TreeGraph } from "./describe";

afterAll(endChildren);

const COUNT = 2000;
const PACKAGE_COUNT = COUNT / 100;

let seed = 1;
const random = (n: number) => (seed = (seed * 48271) % 2147483647) % n;

const pathOf = (i: number) => `src/d${i % 40}/m${i}.${i >= 1000 && i % 5 === 4 ? "js" : "ts"}`;
const specifierOf = (j: number) => "../" + pathOf(j).slice("src/".length);

const files: DirectoryTree = {};
for (let i = 0; i < COUNT; i++) {
  const specifiers = [2 * i + 1, 2 * i + 2].filter(j => j < COUNT).map(specifierOf);
  const other = random(COUNT);
  if (other !== i) specifiers.push(specifierOf(other));
  if (i % 100 === 0) specifiers.push(`pkg${i / 100}`);
  files[pathOf(i)] = [...specifiers.map(specifier => `import "${specifier}";`), `export const v = ${i};`].join("\n");
}
for (let k = 0; k < PACKAGE_COUNT; k++) {
  files[`node_modules/pkg${k}`] = {
    "package.json": JSON.stringify({ name: `pkg${k}`, version: "1.0.0", main: "./index.js", types: "./index.d.ts" }),
    "index.js": "exports.k = 1;",
    "index.d.ts": "export declare const k: number;",
  };
}

function computeCompiledFiles(graph: TreeGraph): string[] {
  const compiledFiles: string[] = [];
  const entered = new Set<string>();
  const stack: [path: string, nextEdge: number][] = [];
  const enter = (path: string) => {
    if (entered.has(path)) return;
    entered.add(path);
    stack.push([path, 0]);
  };
  for (const entryPoint of graph.entryPoints) {
    enter(entryPoint);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const file = graph.file(frame[0]);
      if (frame[1] < file.codeEdges.length) {
        enter(file.codeEdges[frame[1]++]);
      } else {
        stack.pop();
        if (file.role !== "TypesOnly") compiledFiles.push(file.path);
      }
    }
  }
  return compiledFiles;
}

// TODO: the main files of the packages are not the last in the numbering.
test.todo("numbering does not depend on the thread count", () => {
  using tree = tempDir("aot-loader-numbering", files);
  const load = (threads: number) => describeDirectory(String(tree), [pathOf(0)], { threads });
  const one = load(1);
  const sixteen = load(16);
  const again = load(16);

  expect({
    files: one.paths.length,
    compiledFiles: one.compiledFiles.length,
    diagnostics: one.diagnostics,
  }).toEqual({
    files: COUNT + 2 * PACKAGE_COUNT,
    compiledFiles: COUNT + PACKAGE_COUNT,
    diagnostics: [],
  });
  expect(sixteen.raw).toEqual(one.raw);
  expect(again.raw).toEqual(one.raw);
  expect(one.compiledFiles).toEqual(computeCompiledFiles(one));

  const packageMains = Array.from({ length: PACKAGE_COUNT }, (_, k) => `node_modules/pkg${k}/index.js`);
  expect(new Set(one.paths.slice(-PACKAGE_COUNT))).toEqual(new Set(packageMains));
});

const leaf = "node_modules/leaf/index.js";
const sharedDeclarations = "node_modules/shared/index.d.ts";
const outerDeclarations = "node_modules/outer/index.d.ts";

function packageWithDeclarations(name: string, dependency: string): Record<string, string> {
  const manifest = { name, version: "1.0.0", main: "./index.js", types: "./index.d.ts" };
  return {
    [`node_modules/${name}/package.json`]: JSON.stringify(manifest),
    [`node_modules/${name}/index.js`]: `require("${dependency}");`,
    [`node_modules/${name}/index.d.ts`]: `import "${dependency}";`,
  };
}

// The task for the last import runs first: shared/index.d.ts is loaded through outer at depth 2 and reached again from
// main.ts at depth 1. So its import of leaf/index.js is at depth 3, then at depth 2.
function filesWithDepthLimit(maxNodeModuleJsDepth: number): Record<string, string> {
  return {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        strict: true,
        target: "ESNext",
        module: "Preserve",
        moduleResolution: "bundler",
        noEmit: true,
        types: [],
        allowJs: true,
        maxNodeModuleJsDepth,
      },
      files: ["main.ts"],
    }),
    "main.ts": 'import "shared";\nimport "outer";',
    ...packageWithDeclarations("outer", "shared"),
    ...packageWithDeclarations("shared", "leaf"),
    "node_modules/leaf/package.json": JSON.stringify({ name: "leaf", version: "1.0.0", main: "./index.js" }),
    [leaf]: "exports.leaf = 1;",
  };
}

// tsc starts the imports of a file once (`parseTask.startedSubTasks`), so the lower depth never reaches leaf/index.js.
// A compile build starts them again.
const depthLimits: [maxNodeModuleJsDepth: number, compileHasTypeEdge: boolean, tscLoadsLeaf: boolean][] = [
  [1, false, false],
  [2, true, false],
  [3, true, true],
];

// TODO: the declaration files of the two packages are numbered behind their JavaScript files.
test.todo.each(depthLimits)(
  "maxNodeModuleJsDepth %d: a file loaded at depth 2 is reached at depth 1",
  (maxNodeModuleJsDepth, compileHasTypeEdge) => {
    using tree = tempDir("aot-loader-depth", filesWithDepthLimit(maxNodeModuleJsDepth));
    const load = (threads: number) => describeDirectory(String(tree), ["main.ts"], { threads });
    const one = load(1);
    const packageMains = ["node_modules/shared/index.js", "node_modules/outer/index.js"];

    expect({
      diagnostics: one.diagnostics,
      paths: one.paths,
      typeEdges: one.file(sharedDeclarations).typeEdges,
      compiledFiles: one.compiledFiles,
    }).toEqual({
      diagnostics: [],
      paths: ["main.ts", sharedDeclarations, outerDeclarations, leaf, ...packageMains],
      typeEdges: compileHasTypeEdge ? [leaf] : [],
      compiledFiles: [leaf, ...packageMains, "main.ts"],
    });
    expect(load(16).raw).toEqual(one.raw);
  },
);

async function listProgramFiles(command: string[], maxNodeModuleJsDepth: number): Promise<string[]> {
  const treeFiles = filesWithDepthLimit(maxNodeModuleJsDepth);
  using tree = tempDir("aot-loader-depth", treeFiles);
  const lines = await linesOf([...command, "--listFilesOnly"], String(tree), String(tree));
  return lines.map(line => line.slice("/".length)).filter(path => path in treeFiles);
}

function listAtEachLimit(command: string[]): Promise<string[][]> {
  return Promise.all(depthLimits.map(([maxNodeModuleJsDepth]) => listProgramFiles(command, maxNodeModuleJsDepth)));
}

const tscProgramFiles = depthLimits.map(([, , tscLoadsLeaf]) => [
  ...(tscLoadsLeaf ? [leaf] : []),
  sharedDeclarations,
  outerDeclarations,
  "main.ts",
]);

test("bun check lists the files of tsc in the order of tsc", async () => {
  expect(await listAtEachLimit([bunExe(), "check"])).toEqual(tscProgramFiles);
});

test.skipIf(!tsc)("tsc lists those files in that order", async () => {
  expect(await listAtEachLimit([tsc!, "--singleThreaded"])).toEqual(tscProgramFiles);
});
