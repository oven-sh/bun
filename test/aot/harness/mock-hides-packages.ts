// What only a mocked module imports is not loaded: that is what such a mock is laid for. Where the loader of the host walks a graph, over layers and
// behind a way back through require(), a CommonJS file ran although its one importer was mocked.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { beforeAll, describe, test } from "../supported";
import { afterAll } from "./default-timeout";
import { run } from "./run";
import { runsWholeGrids } from "./ways";

const main = (lib: string) => `import { v } from "./${lib}";\nconsole.log("SEEN main", v);\n`;
const hoisted = (lib: string) => `import { test, vi } from "bun:test";
import "./main.mjs";
vi.mock("./${lib}", () => ({ v: "mock v" }));
test("t", () => {});
`;
const inTest = (mocked: string, body: string, exports = `{ v: "mock v" }`) => `import { mock, test } from "bun:test";
test("t", async () => {
  mock.module("./${mocked}", () => (${exports}));
  ${body}
});
`;
const inCommonJSTest = (body: string) => `const { mock, test } = require("bun:test");
test("t", async () => {
  mock.module("./lib.mjs", () => ({ v: "mock v" }));
  await import("./main.mjs");
  ${body}
});
`;
const list = (name: string) =>
  `const ns = await import("${name}");\n  console.log("SEEN main mock v", Object.keys(ns).join(), ns.v, ns.d, ns.extra);`;
const lib = `import d from "driver";\nconsole.log("SEEN lib runs");\nexport let v = "real v" + d.d;\n`;
const driver = (body: string, type = "commonjs") => ({
  "node_modules/driver/package.json": `{ "name": "driver", "main": "./index.js", "type": "${type}" }`,
  "node_modules/driver/index.js": `console.log("SEEN driver runs");\n${body}\n`,
});

const projects: Record<string, Record<string, string>> = {
  "a CommonJS package": { "a.test.mjs": hoisted("lib.mjs"), ...driver(`exports.d = 1;`) },
  "a package that throws at its load": {
    "a.test.mjs": hoisted("lib.mjs"),
    ...driver(`throw new Error("no database here");`),
  },
  "mock.module() in a test": {
    "a.test.mjs": `import { mock, test } from "bun:test";
test("t", async () => {
  mock.module("./lib.mjs", () => ({ v: "mock v" }));
  await import("./main.mjs");
});
`,
    ...driver(`exports.d = 1;`),
  },
  "what the package requires": {
    "a.test.mjs": hoisted("lib.mjs"),
    ...driver(`exports.d = require("deep").n;`),
    "node_modules/deep/package.json": `{ "name": "deep", "main": "./index.js" }`,
    "node_modules/deep/index.js": `console.log("SEEN deep runs");\nexports.n = 1;\n`,
  },
  "an ES package": { "a.test.mjs": hoisted("lib.mjs"), ...driver(`export default { d: 1 };`, "module") },
  "another file imports the package too": {
    "a.test.mjs": hoisted("lib.mjs"),
    "main.mjs": `import { v } from "./lib.mjs";\nimport d from "driver";\nconsole.log("SEEN main", v, d.d);\n`,
    ...driver(`exports.d = 1;`),
  },
  // A way back through require() sends the graph to the loader of the run time.
  ...Object.fromEntries(
    Object.entries({
      "in a function that nobody calls": `exports.late = () => require("./lib.mjs").v;`,
      "in its body": `exports.lib = require("./lib.mjs");`,
      "by a name made at run time": `exports.v = require("./" + String("lib") + ".mjs").v;`,
      "by a name made at run time, and its importer": `exports.names = Object.keys(require("./" + String("main") + ".mjs"));`,
    }).map(([where, body]) => [
      `a file of the project that requires the mocked module back ${where}`,
      {
        "a.test.mjs": hoisted("lib.mjs"),
        "lib.mjs": `import "./driver.cjs";\nconsole.log("SEEN lib runs");\nexport let v = "real v";\n`,
        "driver.cjs": `console.log("SEEN driver runs");\n${body}\n`,
      },
    ]),
  ),
  "the next test file has no mock": {
    "a.test.mjs": hoisted("lib.mjs"),
    "b.test.mjs": `import { test } from "bun:test";\nimport { v } from "./lib.mjs";\ntest("t", () => console.log("SEEN b", v));\n`,
    ...driver(`exports.d = 1;`),
  },
  // The mock has ended, and the module runs for an importer that ran while it stood. Nothing has loaded the package by then.
  "the next test file imports only a user of the module": {
    "main.mjs": `import { v } from "./lib.mjs";\nexport const read = () => v;\n`,
    "a.test.mjs": inTest("lib.mjs", `console.log("SEEN main", (await import("./main.mjs")).read());`),
    "b.test.mjs": `import { test } from "bun:test";\nimport { read } from "./main.mjs";\ntest("t", () => console.log("SEEN b", read()));\n`,
    ...driver(`exports.d = 1;`),
  },
  "what a first mock kept from running stands below a second mock": {
    "root.mjs": `import { v } from "./lib.mjs";\nconsole.log("SEEN root", v);\n`,
    "lib.mjs": `import { x } from "./x.mjs";\nexport let v = "lib " + x;\n`,
    "x.mjs": `console.log("SEEN x runs");\nexport let x = "real x";\n`,
    "a.test.mjs": inTest("x.mjs", `console.log("SEEN main mock v", (await import("./lib.mjs")).v);`, `{ x: "mock x" }`),
    "b.test.mjs": inTest("lib.mjs", `await import("./root.mjs");`),
  },
  // The loader has not come to such a file, so nothing that asks what the loader holds finds it.
  "a file that throws runs again at every require()": {
    "lib.mjs": `import h from "./hidden.cjs";\nexport let v = "real v" + h.d;\n`,
    "hidden.cjs": `console.log("SEEN hidden runs");\nthrow new Error("hidden threw");\n`,
    "a.test.mjs": `${hoisted("lib.mjs").replace(/test\("t".*\n/, "")}import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
test("t", () => {
  for (const turn of [1, 2, 3]) {
    try {
      require("./hidden.cjs");
    } catch (error) {
      console.log("SEEN caught", turn, error.message);
    }
  }
});
`,
  },
  "a file that throws runs again at every require() of a CommonJS test file": {
    "lib.mjs": `import h from "./hidden.cjs";\nexport let v = "real v" + h.d;\n`,
    "hidden.cjs": `console.log("SEEN hidden runs");\nthrow new Error("hidden threw");\n`,
    "a.test.cjs": inCommonJSTest(`for (const turn of [1, 2, 3]) {
    try {
      require("./hidden.cjs");
    } catch (error) {
      console.log("SEEN caught", turn, error.message);
    }
  }`),
  },
  "a file runs again behind a falsy entry in require.cache": {
    "lib.mjs": `import h from "./hidden.cjs";\nexport let v = "real v" + h.d;\n`,
    "hidden.cjs": `console.log("SEEN hidden runs");\nexports.d = 1;\n`,
    "a.test.cjs": inCommonJSTest(`for (const entry of [undefined, 0, false]) {
    console.log("SEEN required", require("./hidden.cjs").d);
    require.cache[require.resolve("./hidden.cjs")] = entry;
  }`),
  },
  "require.cache lists neither the module nor a built-in module that it alone imports": {
    "lib.mjs": `import "ws";\nimport "undici";\nimport "./hidden.mjs";\nexport let v = "real v";\n`,
    "hidden.mjs": `console.log("SEEN hidden runs");\n`,
    "a.test.cjs": inCommonJSTest(
      `console.log("SEEN listed", Object.keys(require.cache).map(key => require("node:path").basename(key)).filter(key => /^(hidden|lib|main|ws|undici)/.test(key)).sort().join());`,
    ),
  },
  "a data file comes in the form that is asked for": {
    "lib.mjs": `import path from "./d.txt" with { type: "file" };\nexport let v = "real v" + path.length;\n`,
    "d.txt": "the text",
    "a.test.cjs": inCommonJSTest(
      `console.log("SEEN text", (await import("./d.txt", { with: { type: "text" } })).default);`,
    ),
  },
  "a plugin that is laid later serves the module": {
    "lib.mjs": `import { e } from "./hidden.mjs";\nexport let v = "real v" + e;\n`,
    "hidden.mjs": `console.log("SEEN hidden runs");\nexport let e = "of the file";\n`,
    "a.test.cjs": inCommonJSTest(`Bun.plugin({
    name: "p",
    setup(build) {
      build.onLoad({ filter: /hidden\\.mjs$/ }, () => ({ contents: 'export let e = "of the plugin";', loader: "js" }));
    },
  });
  console.log("SEEN e", (await import("./hidden.mjs")).e);`),
  },
  // Such a mock has no `export *`.
  ...Object.fromEntries(
    Object.entries({
      "is imported": { "a.test.mjs": inTest("lib.mjs", list("./lib.mjs")) },
      "is passed on by another star": {
        "index.mjs": `export * from "./lib.mjs";\nexport let own = 1;\n`,
        "a.test.mjs": inTest("lib.mjs", list("./index.mjs")),
      },
      "stars a file of the project": {
        "lib.mjs": `export * from "./driver.cjs";\nconsole.log("SEEN lib runs");\nexport let v = "real v";\n`,
        "driver.cjs": `console.log("SEEN driver runs");\nexports.d = 1;\n`,
        "index.mjs": `export * from "./lib.mjs";\n`,
        "a.test.mjs": inTest("lib.mjs", list("./index.mjs")),
      },
      "gets a name from the mock that the package has too": {
        "a.test.mjs": inTest("lib.mjs", list("./lib.mjs"), `{ v: "mock v", extra: 7, d: "mock d" }`),
      },
      "stands beside a star that is followed": {
        "index.mjs": `export * from "./lib.mjs";\nexport * from "second";\n`,
        "node_modules/second/package.json": `{ "name": "second", "main": "./index.js" }`,
        "node_modules/second/index.js": `console.log("SEEN second runs");\nexports.s = 3;\n`,
        "a.test.mjs": inTest("lib.mjs", list("./index.mjs")),
      },
      "has its stars again in the next test file": {
        "a.test.mjs": inTest("lib.mjs", list("./lib.mjs")),
        "b.test.mjs": `import { test } from "bun:test";\nimport * as ns from "./lib.mjs";\ntest("t", () => console.log("SEEN b", Object.keys(ns).join(), ns.v, ns.d));\n`,
      },
      "was loaded before the mock": {
        "a.test.mjs": `import { mock, test } from "bun:test";
import * as ns from "./lib.mjs";
test("t", () => {
  mock.module("./lib.mjs", () => ({ v: "mock v" }));
  console.log("SEEN main mock v", Object.keys(ns).join(), ns.v, ns.d);
});
`,
      },
    }).map(([what, files]) => [
      `a mocked module with a star over a package ${what}`,
      {
        "lib.mjs": `export * from "driver";\nconsole.log("SEEN lib runs");\nexport let v = "real v";\n`,
        ...driver(`exports.d = 1;`),
        ...files,
      },
    ]),
  ),
};

async function runTests(directory: string, words: string | undefined, flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  // What several workers print comes out on stderr, under the name of the test file.
  const printed = `${stdout}\n${stderr}`.split("\n").filter(line => line.startsWith("SEEN"));
  return { stdout: printed, stderr, exitCode };
}

const filesOf = (files: Record<string, string>) => ({
  "package.json": `{ "name": "p" }`,
  "lib.mjs": lib,
  "main.mjs": main("lib.mjs"),
  ...files,
});

function expectOfPlain(name: string, stdout: string[]) {
  const first = /^another file|was loaded before/.test(name)
    ? "driver runs"
    : name.endsWith("that is followed")
      ? "second runs"
      : "main mock v";
  expect(stdout[0]).toStartWith("SEEN " + first);
}

const layers = ["TestRunLayers:0", "TestRunLayers:1", "TestRunLayers:2"];
const workers = "two workers, and no memory to spare";
const compiled = (directory: string, way: string, testFiles: string[] = []) =>
  way === workers
    ? runTests(directory, undefined, ["--aot", "--parallel=2", "--aot-memory-limit=1KB", ...testFiles])
    : runTests(directory, way, ["--aot", ...testFiles]);

/**
 * All the projects as one, each in a folder of its own, which every line that it prints names: one build judges them all, project by project.
 * The lowest layer holds all of Bun's own library whatever stands above it: a project that is built by itself pays that for itself.
 */
function asOneProject(way: string) {
  const folders = Object.entries(projects).map(([name, files], index) => ({
    name,
    index,
    folder: String(index).padStart(2, "0"),
    files: filesOf(files),
    testFiles: Object.keys(files).filter(path => path.includes(".test.")),
  }));
  // What lists require.cache goes first: without `--isolate` the files of a run share it.
  const inTurn = folders
    .toSorted(
      (a, b) => Number(b.name.startsWith("require.cache lists")) - Number(a.name.startsWith("require.cache lists")),
    )
    .flatMap(({ folder, testFiles }) => testFiles.map(path => `./${folder}/${path}`));
  type Seen = { stdout: string[]; tests: string[] };
  const byFolder = ({ stdout, stderr, exitCode }: Awaited<ReturnType<typeof runTests>>) => {
    const seen: Seen[] = folders.map(() => ({ stdout: [], tests: [] }));
    for (const line of stdout) seen[Number(line.slice(5, 7))].stdout.push("SEEN " + line.slice(8));
    let folder = -1;
    // The run ends with a list of all that failed.
    for (const line of stderr.split(/^\d+ tests failed:$/m)[0].split("\n")) {
      const file = line.match(/^(\d\d)[\\/]\S+:$/);
      if (file) folder = Number(file[1]);
      else if (/^\((pass|fail)\) /.test(line)) seen[folder].tests.push(line.replace(/ \[[\d.]+m?s\]$/, ""));
    }
    return { seen, exitCode };
  };
  // Two workers print their files as they end.
  const inOrder = ({ stdout, tests }: Seen) =>
    way === workers ? { stdout: stdout.toSorted(), tests: tests.toSorted() } : { stdout, tests };

  describe("as one project", () => {
    let dir: ReturnType<typeof tempDir> | undefined;
    let plain: ReturnType<typeof byFolder>;
    let expected: typeof plain;
    let built: Promise<typeof plain> | undefined;
    const whenBuilt = () => (built ??= compiled(String(dir), way, inTurn).then(byFolder));
    beforeAll(async () => {
      const all: Record<string, string> = { "package.json": `{ "name": "all" }` };
      for (const { folder, files } of folders)
        for (const [path, text] of Object.entries(files))
          all[`${folder}/${path}`] = text.replaceAll("SEEN ", `SEEN ${folder} `);
      dir = tempDir("aot-mock-hides-packages", all);
      plain = byFolder(await runTests(String(dir), undefined, inTurn));
      expected =
        way === workers ? byFolder(await runTests(String(dir), undefined, ["--parallel=2", ...inTurn])) : plain;
    });
    afterAll(() => dir?.[Symbol.dispose]());

    describe.each(folders)("$name", ({ name, index, testFiles }) => {
      test("plain Bun", () => {
        expect(plain.seen[index].tests).toEqual(testFiles.map(() => "(pass) t"));
        expectOfPlain(name, plain.seen[index].stdout);
      });

      test(way, async () => {
        const { seen } = await whenBuilt();
        expect(inOrder(seen[index])).toEqual(inOrder(expected.seen[index]));
      });
    });

    test("the exit code", async () => {
      expect(plain.exitCode).toBe(0);
      expect((await whenBuilt()).exitCode).toBe(expected.exitCode);
    });
  });
}

/**
 * Built by themselves too in front of every merge. What one project does can make a build careful with the files of all: a fault in which files
 * may load again showed in the second by itself, and not beside the others.
 */
const witnesses = ["a CommonJS package", "a file that throws runs again at every require()"];

/**
 * The family is about the layers, so every project goes through every way. By itself a project is built four times, three of them in layers, each build in a case
 * of its own: under a sanitizer minutes of processor time. So the projects are dealt to several test files: of `of` files, this one takes every `of`-th project,
 * from the `part`-th on. In front of a merge only the witnesses are built so: each of the first four files builds all the projects as one, in one way.
 */
export function mockHidesPackages(part: number, of: number) {
  const way = [...layers, workers][part];
  if (way && !runsWholeGrids) asOneProject(way);
  for (const [name, files] of Object.entries(projects).filter((_, index) => index % of === part)) {
    const isBuilt = runsWholeGrids || witnesses.includes(name);
    describe(name, () => {
      let dir: ReturnType<typeof tempDir> | undefined;
      let plain: { stdout: string[]; exitCode: number };
      let parallel: typeof plain;
      const answers = ({ stdout, exitCode }: Awaited<ReturnType<typeof runTests>>) => ({ stdout, exitCode });
      beforeAll(async () => {
        dir = tempDir("aot-mock-hides-packages", filesOf(files));
        plain = answers(await runTests(String(dir), undefined, []));
        if (isBuilt) parallel = answers(await runTests(String(dir), undefined, ["--parallel=2"]));
      });
      afterAll(() => dir?.[Symbol.dispose]());

      test("plain Bun", () => {
        expect(plain.exitCode).toBe(0);
        expectOfPlain(name, plain.stdout);
      });
      if (!isBuilt) return;

      test.concurrent.each(layers)("%s", async words => {
        expect(answers(await compiled(String(dir), words))).toEqual(plain);
      });

      test.concurrent(workers, async () => {
        // Two workers print their files as they end.
        const sorted = ({ stdout, exitCode }: typeof plain) => ({ stdout: stdout.toSorted(), exitCode });
        expect(sorted(answers(await compiled(String(dir), workers)))).toEqual(sorted(parallel));
      });
    });
  }
}
