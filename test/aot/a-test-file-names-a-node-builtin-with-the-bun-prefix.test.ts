import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// `bun:fs` means `fs` to the transpiler, which prints `fs` wherever it reads the name: in `require(K)`, `import(K)`, `require.resolve(K)`, and in each arm of a choice there.
// The loader does not know the name. Every other call hands it to the loader: `import.meta.require`, what `createRequire` made, `require` through `call` and `apply`,
// `require` with a second argument, `process.getBuiltinModule`.
// Where nothing is found the error names what the program asked for: `require.resolve(__dirname + "/none.cjs")` asks for the whole path.
const asks = `
const ask = async (label, load) => {
  try { console.log("SAID", tag, label, clean(await load())); }
  catch (error) { console.log("SAID", tag, label, "THROWS", error?.constructor?.name, error?.code, clean(error?.message).split("\\n")[0]); }
};
`;

const moduleFile = (tag: string) => `import { test } from "bun:test";
import { createRequire } from "node:module";
const tag = "${tag}";
const here = import.meta.dirname;
const clean = value => String(value).replaceAll(here, "<here>");
${asks}
const made = createRequire(import.meta.url);
const quiet = process.argv.length > 90;
test(tag, async () => {
  await ask("require", () => typeof require("bun:fs").readFileSync);
  await ask("(0, require)", () => typeof (0, require)("bun:fs").readFileSync);
  await ask("import()", async () => typeof (await import("bun:fs")).readFileSync);
  await ask("require.resolve", () => require.resolve("bun:fs"));
  await ask("a choice, require", () => require(quiet ? "bun:os" : "bun:fs") === require("node:fs"));
  await ask("a choice of three, require", () => require(quiet ? "bun:os" : !quiet ? "bun:path" : "./${tag}-none.cjs") === require("node:path"));
  await ask("a choice, import()", async () => (await import(quiet ? "bun:os" : "bun:fs")).default === require("node:fs"));
  await ask("a choice, require.resolve", () => require.resolve(quiet ? "bun:os" : "bun:fs"));
  await ask("import.meta.require", () => typeof import.meta.require("bun:fs"));
  await ask("a choice, import.meta.require", () => typeof import.meta.require(quiet ? "bun:os" : "bun:fs"));
  await ask("import.meta.require under another name", () => { const load = import.meta.require; return typeof load("bun:fs"); });
  await ask("what createRequire made", () => typeof made("bun:fs"));
  await ask("what createRequire made, called at once", () => typeof createRequire(import.meta.url)("bun:fs"));
  await ask("what createRequire made for another file", () => typeof createRequire("/")("bun:fs"));
  await ask("its resolve", () => made.resolve("bun:fs"));
  await ask("require.call", () => typeof require.call(null, "bun:fs"));
  await ask("require.apply", () => typeof require.apply(null, ["bun:fs"]));
  await ask("require under another name", () => { const load = require; return typeof load("bun:fs"); });
  await ask("require with a second argument", () => typeof require("bun:fs", 1));
  await ask("process.getBuiltinModule", () => typeof process.getBuiltinModule("bun:fs"));
  await ask("the names that the loader knows", () => [import.meta.require("node:fs"), made("fs"), require.call(null, "fs"), process.getBuiltinModule("fs")].every(it => it === require("bun:fs")));
  await ask("require.resolve of a whole path that is missing", () => require.resolve(here + "/${tag}-none.cjs"));
  await ask("require.resolve of a whole path above that is missing", () => require.resolve(here + "/../${tag}-none.cjs"));
  await ask("require of a whole path that is missing", () => require(here + "/${tag}-none.cjs"));
  await ask("import() of a whole path that is missing", () => import(here + "/${tag}-none.mjs"));
  await ask("import.meta.require of a whole path that is missing", () => import.meta.require(here + "/${tag}-none.cjs"));
  await ask("require.resolve of a relative path that is missing", () => require.resolve("./${tag}-none.cjs"));
  await ask("require.resolve of a package that is missing", () => require.resolve("${tag}-none"));
  await ask("import.meta.resolve of a package that is missing", () => import.meta.resolve("${tag}-none"));
  await ask("import.meta.resolve of a relative path that is missing", () => import.meta.resolve("./${tag}-none.mjs"));
});
`;

const choiceFile = (tag: string) => `import { test } from "bun:test";
const tag = "${tag}";
const clean = String;
${asks}
const quiet = process.argv.length > 90;
test(tag, async () => {
  await ask("a choice, process.getBuiltinModule", () => typeof process.getBuiltinModule(quiet ? "bun:os" : "bun:fs"));
  await ask("a choice of names that the loader knows", () => process.getBuiltinModule(quiet ? "os" : "fs") === require("bun:fs"));
  // The program of a test file holds no copy of \`fs\`, whatever names it computes: the program below has the one that runs.
  const later = name => name + (quiet ? "x" : "");
  await ask("process.getBuiltinModule of a computed name", () => typeof process.getBuiltinModule(later("nothing")));
  await ask("import() of a computed name beside it", async () => (await import(later("fs"))).default === require("node:fs"));
});
`;

const commonJsFile = (tag: string) => `const { test } = require("bun:test");
const { createRequire } = require("node:module");
const tag = "${tag}";
const clean = value => String(value).replaceAll(__dirname, "<here>");
${asks}
const made = createRequire(__filename);
const quiet = process.argv.length > 90;
test(tag, async () => {
  await ask("require", () => typeof require("bun:fs").readFileSync);
  await ask("module.require", () => typeof module.require("bun:fs").readFileSync);
  await ask("a choice, require", () => require(quiet ? "bun:os" : "bun:fs") === require("node:fs"));
  await ask("what createRequire made", () => typeof made("bun:fs"));
  await ask("require.call", () => typeof require.call(null, "bun:fs"));
  await ask("require.apply", () => typeof require.apply(null, ["bun:fs"]));
  await ask("require under another name", () => { const load = require; return typeof load("bun:fs"); });
  await ask("module.require.call", () => typeof module.require.call(module, "bun:fs"));
  await ask("require.resolve of a whole path that is missing", () => require.resolve(__dirname + "/${tag}-none.cjs"));
  await ask("require of a whole path that is missing", () => require(__dirname + "/${tag}-none.cjs"));
});
`;

const workers = ["--isolate", "--parallel=2"];

async function ask(flags: string[], words: string, files: string[]) {
  using dir = tempDir("aot-bun-prefixed-node-builtins", {
    "tsconfig.json": "{}",
    "a.test.js": moduleFile("a"),
    "b.test.js": moduleFile("b"),
    "c.test.cjs": commonJsFile("c"),
    "d.test.js": choiceFile("d"),
  });
  const directory = String(dir);
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_TMPDIR: directory };
  const ran = await run([bunExe(), "test", ...flags, ...files], directory, env);
  return {
    lines: (ran.stdout + "\n" + ran.stderr)
      .split("\n")
      .filter(line => line.startsWith("SAID"))
      .sort(),
    summary: ran.stderr.split("\n").filter(line => /^ *\d+ (pass|fail)$/.test(line)),
  };
}

test("each call finds what it finds in plain Bun, alone and as one program", async () => {
  const alone = await ask([], "", ["./a.test.js"]);
  expect(alone.summary).toEqual([" 1 pass", " 0 fail"]);
  expect(alone.lines.length).toBe(30);
  expect(alone.lines).toContain("SAID a a choice, require true");
  expect(alone.lines).toContain("SAID a process.getBuiltinModule undefined");
  expect(alone.lines).toContain(
    "SAID a import.meta.require THROWS ResolveMessage MODULE_NOT_FOUND Cannot find module 'bun:fs'",
  );
  expect(alone.lines).toContain(
    "SAID a require.resolve of a whole path that is missing THROWS ResolveMessage MODULE_NOT_FOUND Cannot find module '<here>/a-none.cjs'",
  );
  expect(await ask(["--aot"], "", ["./a.test.js"])).toEqual(alone);
  const all = await ask(workers, "", ["."]);
  expect(all.lines.length).toBe(74);
  expect(await ask(["--aot"], "", ["."])).toEqual(all);
  expect(await ask(["--aot", ...workers], "TestRunLayers:0", ["."])).toEqual(all);
});

test("and in layers, one test file to a program or all of them", async () => {
  const all = await ask(workers, "", ["."]);
  expect(all.summary).toEqual([" 4 pass", " 0 fail"]);
  expect(all.lines).toContain("SAID a a choice, import() true");
  expect(all.lines).toContain("SAID d a choice, process.getBuiltinModule undefined");
  expect(all.lines).toContain("SAID d import() of a computed name beside it true");
  const [each, together] = await Promise.all([
    ask(["--aot", ...workers], "TestRunLayers:2,TestRunPartFiles:1", ["."]),
    ask(["--aot", ...workers], "TestRunLayers:2", ["."]),
  ]);
  expect(each).toEqual(all);
  expect(together).toEqual(all);
});
