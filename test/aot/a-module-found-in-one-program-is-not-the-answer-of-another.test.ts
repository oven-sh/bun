import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

// The search for a module by its path keeps what it found last, in 256 places that all the programs of a process share and that go by
// the hash of the path. It kept the number of the module. Over layers a process has several programs: where two paths share a place,
// the number kept for a module of the layer named, in the program of the test file, the entry for a data file that this program does
// not hold compiled, under the very path that was asked for. So the program answered for a file that it leaves to the loader, the link
// went round on that one entry, and `import("../../helpers/data.json")` was rejected with "RangeError: Maximum call stack size
// exceeded". Whether two paths share a place hangs on every character of them, so the project stands at the one path where it was found.
const project = "/dev/shm/k16-tl-layers/2/w/project";
const files: Record<string, string> = {
  "helpers/builtins.js": "export const drawn = () => 1;\n",
  "helpers/copied-inner.cjs": "",
  "helpers/copied-inner.js": "",
  "helpers/copied-named.js": "",
  "helpers/copied-namespace.js": "",
  "helpers/copied-requires.cjs": 'const { inner, f } = require("./copied-inner.cjs");',
  "helpers/copied-star.js": 'export * from "./copied-inner.js";',
  "helpers/copied-uses.js": "",
  "helpers/data.json": '{ "value": 4, "list": [1, 2, 3] }',
  "helpers/evicted.cjs": "exports.read = () => n;",
  "helpers/shapes.ts": "export class Square implements Shape {\n}",
  "helpers/typed.ts": "",
  "helpers/words.txt": "some words\n",
  "names-the-copies.test.js":
    'test("the modules that are copied elsewhere", async () => { for (const load of [() => import("./helpers/copied-star.js"), () => import("./helpers/copied-named.js"), () => import("./helpers/copied-namespace.js"), () => import("./helpers/copied-uses.js"), () => import("./helpers/copied-requires.cjs")]) expect(typeof (await load())).toBe("object"); });',
  "setup.ts": "",
  "src/deep/file0.test.ts":
    'const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } = Bun.jest(import.meta.path);\nimport { writeFileSync } from "node:fs";\nimport * as builtins from "../../helpers/builtins.js";\nconst store = writeFileSync, asText = JSON.stringify, isList = Array.isArray, joinOf = Array.prototype.join, mapOf = Array.prototype.map;\nconst show = (value: any): string => typeof value === "function" ? "function " + value.name : typeof value === "bigint" ? value + "n" : typeof value === "symbol" ? "symbol" : value === undefined ? "undefined" : Object.is(value, -0) ? "-0" : value instanceof Error ? value.name + ": " + value.message : isList(value) ? "[" + joinOf.call(mapOf.call(value, show), ",") + "]" : typeof value === "object" && value !== null ? asText(value) : String(value);\nconst seen: string[] = [], leftReplaced: unknown[] = [];\nconst note = (label: string, ...values: unknown[]) => { seen.push(label + ": " + joinOf.call(mapOf.call(values, show), " ")); };\ndescribe("a group", () => {\ntest.if(false)("require.cache 0", () => {\n  const path = require.resolve("../../helpers/evicted.cjs");\n});\ntest("files and a server 2", async () => {\n  note("beside the test", (await Bun.file((import.meta.dir + "/../../.") + "/helpers/data.json").json()).value, (await import("../../helpers/data.json")).default.value, require("../../helpers/data.json").list.length, (await import("../../helpers/words.txt")).default.trim());\n  console.error("SEEN", seen.join());\n  leftReplaced.push(() => [Math.random(), builtins.drawn()]);\n});\n});',
  "src/file1.test.js":
    'const { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, mock, spyOn, test } = Bun.jest(import.meta.path);\nimport * as shapes from "../helpers/shapes.ts";',
  "tests/unit/file2.test.mts":
    'import { Level, Names, describeLevel, Base, Kept, isKept } from "../../helpers/typed.ts";',
  "tsconfig.json": "",
};

test.skipIf(!isLinux || !existsSync("/dev/shm"))(
  "a data file is loaded over layers, at the path where it was not",
  async () => {
    // One run at a time can stand there.
    const claimed = dirname(project);
    for (let tries = 0; ; tries++) {
      try {
        mkdirSync(dirname(claimed), { recursive: true });
        mkdirSync(claimed);
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EACCES" || code === "EPERM" || code === "EROFS")
          return void console.error(`SKIPPED: ${claimed} cannot be made here: ${code}`);
        if (code !== "EEXIST" || tries === 240) throw error;
        await Bun.sleep(500);
      }
    }
    try {
      using temporary = tempDir("aot-two-programs-one-path", {});
      for (const [path, text] of Object.entries(files)) {
        mkdirSync(dirname(join(project, path)), { recursive: true });
        writeFileSync(join(project, path), text);
      }
      async function report(...flags: string[]) {
        const env = {
          ...bunEnv,
          BUN_TMPDIR: String(temporary),
          BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1",
        };
        const { stdout, stderr, exitCode } = await run(
          [bunExe(), "test", ...flags, "--isolate", "--parallel=4", "--preload", "./setup.ts"],
          project,
          env,
        );
        if (flags.includes("--aot")) expectLayers(stderr);
        return {
          seen: (stdout + stderr).split("\n").filter(line => line.startsWith("SEEN") || line.includes("RangeError")),
          results: [...stderr.matchAll(/^\((pass|fail|skip)\) (.+?)(?: \[.*\])?$/gm)]
            .map(match => `${match[1]} ${match[2]}`)
            .sort(),
          exitCode,
        };
      }
      const plain = await report();
      expect(plain.seen).toEqual(["SEEN beside the test: 4 4 3 some words"]);
      expect(await report("--aot")).toEqual(plain);
    } finally {
      rmSync(claimed, { recursive: true, force: true });
    }
  },
  240_000,
);
