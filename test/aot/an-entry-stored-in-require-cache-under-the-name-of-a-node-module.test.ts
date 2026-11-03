import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// `require.cache["fs"] = { exports: fake }`: require() looks in the table for a Node.js module that is named without `node:` and answers with what the entry exports.
// require("node:fs"), process.getBuiltinModule("fs") and an import answer with the module.
const head = `import { test } from "bun:test";`;

const project = {
  "package.json": `{}`,
  "node_modules/pk/package.json": `{ "name": "pk", "main": "index.js" }`,
  "node_modules/pk/index.js": `
    exports.fs = () => typeof require("fs").readFileSync;
    exports.os = () => typeof require("os").platform;`,
  "src/required.cjs": `
    exports.fs = () => typeof require("fs").readFileSync;
    exports.nodeFs = () => typeof require("node:fs").readFileSync;
    exports.held = require("fs");`,
  "src/fake-os.cjs": `
    globalThis.fakeOsRuns = (globalThis.fakeOsRuns ?? 0) + 1;
    exports.platform = "a fake";`,

  "spelled.test.js": `${head}
    import { createRequire } from "node:module";
    import realFs from "fs";
    test("under a name that the file spells", async () => {
      const required = require("./src/required.cjs");
      const pk = require("pk");
      console.log("before:", typeof require("fs").readFileSync, required.fs(), pk.fs());
      const entry = { exports: { readFileSync: 1 } };
      require.cache["fs"] = entry;
      console.log("stored:", typeof require("fs").readFileSync, required.fs(), pk.fs());
      console.log("the module:", typeof require("node:fs").readFileSync, required.nodeFs(), typeof process.getBuiltinModule("fs").readFileSync);
      console.log("imports:", typeof realFs.readFileSync, typeof (await import("fs")).readFileSync, typeof required.held.readFileSync);
      console.log("made:", typeof createRequire(import.meta.url)("fs").readFileSync, typeof import.meta.require("fs").readFileSync);
      const name = "fs";
      console.log("names:", typeof require(name).readFileSync, typeof require(Date.now() > 0 ? "fs" : "path").readFileSync, typeof require(["fs"][0]).readFileSync);
      entry.exports = { readFileSync: "text" };
      console.log("other exports:", typeof require("fs").readFileSync, required.fs());
      console.log("the same:", require("fs") === entry.exports, require.cache.fs === entry, Object.keys(require.cache).includes("fs"));
      require.cache["fs"] = undefined;
      console.log("undefined:", typeof require("fs").readFileSync, required.fs());
      require.cache["fs"] = entry;
      delete require.cache["fs"];
      console.log("deleted:", typeof require("fs").readFileSync, required.fs(), pk.fs(), require("fs") === require("node:fs"), require("fs") === realFs);
    });
    test("under other names", () => {
      const pk = require("pk");
      require("./src/fake-os.cjs");
      require.cache[require.resolve("os")] = require.cache[require.resolve("./src/fake-os.cjs")];
      console.log("os:", require("os").platform, pk.os(), typeof require("node:os").platform, globalThis.fakeOsRuns);
      delete require.cache.os;
      console.log("os again:", typeof require("os").platform, pk.os());
      require.cache["fs/promises"] = { get exports() { console.log("exports is read"); return { readFile: 2 }; } };
      console.log("fs/promises:", typeof require("fs/promises").readFile, typeof require("node:fs/promises").readFile);
      delete require.cache["fs/promises"];
      require.cache["node:path"] = { exports: { join: 1 } };
      console.log("node:path:", typeof require("node:path").join, typeof require("path").join);
      delete require.cache["node:path"];
      console.log("untouched:", typeof require("util").inspect, typeof require("path").join);
    });`,
};

// `bun run` reads require("fs") as require("node:fs") in a CommonJS file that an import loads, and as it is written in one that require() loads. The first load counts.
// A build that does not see the test files hears from the scan of them how they load each file.
const loadedByImports = {
  "package.json": `{}`,
  "imported.cjs": `exports.fs = () => typeof require("fs").readFileSync; exports.byName = name => typeof require(name).readFileSync;`,
  "both.cjs": `exports.fs = () => typeof require("fs").readFileSync;`,
  "by-call.cjs": `exports.fs = () => typeof require("fs").readFileSync;`,
  "required.cjs": `exports.fs = () => typeof require("fs").readFileSync;`,
  "one.test.js": `${head}
    import { fs, byName } from "./imported.cjs";
    import * as both from "./both.cjs";
    test("a CommonJS file that an import loads", async () => {
      const byCall = await import("./by-call.cjs");
      require.cache["fs"] = { exports: { readFileSync: 1 } };
      console.log("imported:", fs(), byName("fs"), both.fs(), require("./both.cjs").fs(), byCall.fs(), require("./required.cjs").fs());
      delete require.cache["fs"];
    });`,
};

const refusal = (name: string) =>
  `Cannot store an entry under '${name}' in require.cache: the build read no store under that key, so require("${name}") was compiled to answer with the module`;

type Project = {
  files: Record<string, string>;
  /** What its test file prints under plain `bun test`. A compiled run has to print the same. */
  printed: string[];
  /** How its tests end there. */
  results: string[];
};
const projects: Record<string, Project> = {
  "an entry under the name of a Node.js module answers require()": {
    files: project,
    printed: [
      "before: function function function",
      "stored: number number number",
      "the module: function function function",
      "imports: function function function",
      "made: number number",
      "names: number number number",
      "other exports: string string",
      "the same: true true true",
      "undefined: function function",
      "deleted: function function function true true",
      "os: a fake string function 1",
      "os again: function function",
      "exports is read",
      "fs/promises: number function",
      "node:path: function function",
      "untouched: function function",
    ],
    results: ["pass under a name that the file spells", "pass under other names"],
  },
  "a CommonJS file that an import loads asks for the module": {
    files: loadedByImports,
    printed: ["imported: function number function function function number"],
    results: ["pass a CommonJS file that an import loads"],
  },
};

// How a compiled run says that it is built. A Bun that loads one program a realm (macOS, Windows, a hardened build) has no layers.
const oneRealm = "this Bun loads one program a realm";
const oneProgram = new RegExp(`^one program(: ${oneRealm})? \\| test files 1$`);
type Way = { env: Record<string, string>; form: RegExp; standIn: boolean };
const ways: [string, Way][] = [
  ["as one program", { env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, form: oneProgram, standIn: false }],
  [
    "in layers",
    {
      env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" },
      form: new RegExp(`^(layers 2|programs without layers: ${oneRealm}) \\| test files 1 \\| to a program 1( \\||$)`),
      standIn: false,
    },
  ],
  [
    "with the test files from disk",
    {
      // The word changes no build. With it a run says how it is built, and prints the file that stands in for the test files that its build does not see.
      env: {
        BUN_AOT_TEST_FILES_FROM_DISK: "1",
        BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
        BUN_DEBUG_TEST_AOT_WORDS: "TestRunShowsStandIn:1",
      },
      form: oneProgram,
      standIn: true,
    },
  ],
];

async function runTests(directory: string, env: Record<string, string> = {}, ...flags: string[]) {
  const command = [bunExe(), "test", "--isolate", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  // A crash prints only there.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return {
    // Plain `bun test` says nothing of the kind, and neither does a Bun that takes `--aot` and compiles nothing.
    form: [...stderr.matchAll(/^AOT test run \| ((?:one program|layers|programs without layers)\b.*)$/gm)].map(
      match => match[1],
    ),
    standIn: /^AOT stand-in \| .*[\\/]bun-test-files-from-disk\.js$/m.test(stderr),
    printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
    errors: stderr.split("\n").filter(line => line.startsWith("error")),
    results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`),
    exitCode,
  };
}

const plainRuns = new Map<string, ReturnType<typeof runTests>>();
/** Plain `bun test` in a project: once, however many compiled runs are compared with it. */
const plainRun = (name: string) =>
  plainRuns.getOrInsertComputed(name, async () => {
    using dir = tempDir("an-entry-under-the-name-of-a-node-module", projects[name].files);
    return await runTests(String(dir));
  });

for (const [name, { files, printed, results }] of Object.entries(projects)) {
  for (const [title, { env, form, standIn }] of ways) {
    test.concurrent(`${name}, ${title}`, async () => {
      const plain = await plainRun(name);
      expect(plain).toEqual({ form: [], standIn: false, printed, errors: [], results, exitCode: 0 });
      using dir = tempDir("an-entry-under-the-name-of-a-node-module", files);
      const compiled = await runTests(String(dir), env, "--aot");
      expect(compiled).toEqual({ ...plain, form: [expect.stringMatching(form)], standIn });
    });
  }
}

test.concurrent("in an executable the store throws an error that names the module and says what to write", async () => {
  using dir = tempDir("an-entry-under-a-key-that-nobody-reads-in-an-executable", {
    "main.cjs": `
      const key = ["u", "rl"].join("");
      try {
        require.cache[key] = { exports: { parse: 1 } };
        console.log("stored");
      } catch (error) {
        console.log(error.message);
      }
      console.log(typeof require("url").parse);
      require.cache[["z", "lib"].join("")] = { exports: { gzipSync: 1 } };
      console.log("nobody requires zlib: stored");`,
  });
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable], String(dir));
  expect({
    errors: built.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: built.exitCode,
  }).toEqual({ errors: [], exitCode: 0 });
  const { stdout, stderr, exitCode } = await run([executable], String(dir));
  expect({ stdout: stdout.split("\n"), stderr, exitCode }).toEqual({
    stdout: [
      `${refusal("url")}. Spell the key where it is stored: require.cache["url"] = entry. In a test, mock.module("url", () => ({ .. })) replaces the module too. (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)`,
      "function",
      "nobody requires zlib: stored",
      "",
    ],
    stderr: "",
    exitCode: 0,
  });
});
