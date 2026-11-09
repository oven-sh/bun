// Where the build can't prove which name a `require(name)` gets, it still brings the files whose names are written where the name comes from. That is a guess. A `.cjs` file with no
// require, module, exports, import or export in it is what its first loader makes of it, and a guess says nothing about who comes first. So a guess enters a program only when all
// that is sure has been found, and where a guessed file, or one that it loads, loads a file that leaves what it is to its loader, all guesses go again.
// And a guess comes in whole or not at all: a guessed file that loads under a name nobody can read, or whose own loads would have to be looked for in turn (a further guess, a name
// handed to a helper, a Worker's start, a name out of a data file), would run and find them missing, and a `catch` around them would hide it. The same holds for a file of the
// program behind the guessed load. And a guessed file never stops a build, so none of them is TypeScript, which the build would have to check.
// What a guessed file may name is a short list: what it declares or imports itself, the language's own built-ins (none that runs a text), console, and require, module and exports.
// And it holds no handler: no `try`, nothing asynchronous. What fails in it is then not hidden by it.
// In these the load then fails aloud, as it does without the guess, and the build has pointed at it (TS100064) and said why the written files are not there (TS100089). A case that starts to answer as `bun <file>` is a gain: move it to
// test/aot/parallel/a-file-that-the-build-only-guesses-decides-what-no-other-file-is.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const says = (name: string) =>
  `console.log("SAID ${name}", (function () {\n  return this === undefined ? "strict" : "sloppy";\n})());\n`;
const shared = {
  "package.json": `{ "name": "cell", "type": "module" }\n`,
  "silent.cjs": says("silent"),
  "part.mjs": `import "./silent.cjs";\nexport const part = 1;\n`,
};

const cases: Record<string, { files: Record<string, string>; plain: string; missing: string; said: string }> = {
  "the load runs after all, behind the import": {
    files: {
      "table.mjs": `const table = { part: "./part.mjs" };\nexport const seen = JSON.stringify(table);\nexport const later = () => import.meta.require(table.part);\n`,
      "main.mjs": `import { later } from "./table.mjs";\nawait import("./silent.cjs");\nconsole.log("SAID", later().part);\n`,
    },
    plain: "SAID silent strict\nSAID 1\n",
    missing: "./part.mjs",
    said: "SAID silent strict\n",
  },
  "a require and an import() are guessed to get there": {
    files: {
      "table.mjs": `const table = { part: "./part.mjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.part);\n}\nload(false);\nexport const later = () => import(table.part);\n`,
      "main.mjs": `import { later } from "./table.mjs";\nawait later();\nconsole.log("SAID end");\n`,
    },
    plain: "SAID silent strict\nSAID end\n",
    missing: "./part.mjs",
    said: "",
  },
  "a guessed import() alone gets to a file that the program requires": {
    files: {
      "main.mjs": `import "./start.cjs";\n`,
      "start.cjs": `const table = { part: "./part.mjs" };\nglobalThis.kept = table;\nasync function go(key) {\n  await null;\n  await import(table[key]);\n  require("./silent.cjs");\n}\ngo(["part"][0]);\n`,
    },
    plain: "SAID silent strict\n",
    missing: "./part.mjs",
    said: "",
  },
  "the name is first handed to require.resolve()": {
    files: {
      "table.cjs": `const table = { part: "./part.mjs" };\nexports.seen = JSON.stringify(table);\nexports.found = require(require.resolve(table.part));\n`,
      "main.mjs": `import "./table.cjs";\nawait import("./silent.cjs");\n`,
    },
    plain: "SAID silent sloppy\n",
    missing: "./part.mjs",
    said: "",
  },
  "two guessed files get there, one by import() and one by require()": {
    files: {
      "imports.cjs": `module.exports = import("./silent.cjs");\n`,
      "requires.cjs": `module.exports = require("./silent.cjs");\n`,
      "main.mjs": `const table = { imports: "./imports.cjs", requires: "./requires.cjs" };\nexport const seen = JSON.stringify(table);\nawait import.meta.require(table.imports);\nimport.meta.require(table.requires);\n`,
    },
    plain: "SAID silent strict\n",
    missing: "./imports.cjs",
    said: "",
  },
  "nothing else loads the file": {
    files: {
      "table.mjs": `const table = { part: "./part.mjs" };\nexport const seen = JSON.stringify(table);\nexport const found = import.meta.require(table.part);\n`,
      "main.mjs": `import { found } from "./table.mjs";\nconsole.log("SAID", found.part);\n`,
    },
    plain: "SAID silent sloppy\nSAID 1\n",
    missing: "./part.mjs",
    said: "",
  },
  "an import() alone is guessed to load the file": {
    files: {
      "main.mjs": `const table = { silent: "./silent.cjs" };\nglobalThis.kept = table;\nawait import(table[["silent"][0]]);\n`,
    },
    plain: "SAID silent strict\n",
    missing: "./silent.cjs",
    said: "",
  },
  "such a file comes in with the guesses, and one guessed file names it for sure": {
    files: {
      "first.cjs": `const load = name => require(name);\nmodule.exports = load("./silent.cjs");\n`,
      "main.mjs": `const table = { first: "./first.cjs", silent: "./silent.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go, key) {\n  if (!go) return;\n  return import.meta.require(table[key]);\n}\nload(false, "first");\nawait import(table.silent);\n`,
    },
    plain: "SAID silent strict\n",
    missing: "./silent.cjs",
    said: "",
  },
  "such a file comes in because a guessed file hands its name to a helper of the program": {
    files: {
      "helper.cjs": `exports.load = name => require(name);\n`,
      "first.cjs": `require("./helper.cjs").load("./silent.cjs");\n`,
      "main.mjs": `import "./helper.cjs";\nconst table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nawait import(atob("Li9zaWxlbnQuY2pz"));\n`,
    },
    plain: "SAID silent strict\n",
    missing: "./silent.cjs",
    said: "",
  },
  "a guessed file starts such a file as a Worker": {
    files: {
      "first.cjs": `module.exports = () => new Worker(new URL("./silent.cjs", require("node:url").pathToFileURL(__filename)));\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nawait import(atob("Li9zaWxlbnQuY2pz"));\n`,
    },
    plain: "SAID silent strict\n",
    missing: "./silent.cjs",
    said: "",
  },
  "a guessed file loads under a name that nobody can read, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `let said;\ntry {\n  said = require(atob("Li9pbm5lci5janM=")).word;\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file guesses further, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `const table = { inner: "./inner.cjs" };\nexports.seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return require(table.inner);\n}\nload(false);\nlet said;\ntry {\n  said = load(true).word;\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file hands a name to a helper, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "helper.cjs": `exports.load = name => require(name);\n`,
      "first.cjs": `let said;\ntry {\n  said = require("./helper.cjs").load("./inner.cjs").word;\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file resolves under a name that nobody can read, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `let said;\ntry {\n  said = require.resolve(atob("Li9pbm5lci5janM=")).endsWith("inner.cjs") ? "real" : "other";\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file keeps its require as a value, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `const box = { load: require };\nlet said;\ntry {\n  said = box.load(atob("Li9pbm5lci5janM=")).word;\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file asks a resolver of the host, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `let said;\ntry {\n  said = Bun.resolveSync(atob("Li9pbm5lci5janM="), __dirname).endsWith("inner.cjs") ? "real" : "other";\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file keeps require.resolve as a value, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `let said;\ntry {\n  said = [require.resolve].map(resolve => resolve(atob("Li9pbm5lci5janM=")))[0].endsWith("inner.cjs") ? "real" : "other";\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file names a global that somebody else has stored": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `let said;\ntry {\n  said = storedLoader(atob("Li9pbm5lci5janM=")).word;\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "stores.cjs": `globalThis.storedLoader = require;\n`,
      "main.mjs": `import "./stores.cjs";\nconst table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file gets to the host through the constructor of a function, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `let said;\ntry {\n  const host = (() => {}).constructor("return Bun")();\n  said = host.resolveSync([..."sjc.renni/."].reverse().join(""), ".").endsWith("inner.cjs") ? "real" : "other";\n} catch {\n  said = "fallback";\n}\nexports.said = said;\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "the program itself goes on to a name that nobody can read, and catches": {
    files: {
      "inner.cjs": `exports.word = "real";\n`,
      "first.cjs": `exports.said = "first";\n`,
      "main.mjs": `const table = { first: "./first.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nload(true);\nlet said;\ntry {\n  said = import.meta.require(atob("Li9pbm5lci5janM=")).word;\n} catch {\n  said = "fallback";\n}\nconsole.log("SAID", said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.cjs",
    said: "",
  },
  "a guessed file is TypeScript": {
    files: {
      "first.ts": `export const said: string = "real";\n`,
      "main.mjs": `const table = { first: "./first.ts" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.first);\n}\nload(false);\nconsole.log("SAID", load(true).said);\n`,
    },
    plain: "SAID real\n",
    missing: "./first.ts",
    said: "",
  },
  "another name of the same file would have been harmless": {
    files: {
      "other.cjs": `module.exports = 1;\n`,
      "main.mjs": `const table = { part: "./part.mjs", other: "./other.cjs" };\nexport const seen = JSON.stringify(table);\nconsole.log("SAID", import.meta.require(table.other));\nif (process.argv.length > 99) import.meta.require(table.part);\nawait import("./silent.cjs");\n`,
    },
    plain: "SAID 1\nSAID silent strict\n",
    missing: "./other.cjs",
    said: "",
  },
};

for (const [name, { files, plain, missing, said }] of Object.entries(cases)) {
  test(name, async () => {
    using dir = tempDir("a-file-that-the-build-only-guesses", { ...shared, ...files });
    const cwd = String(dir);
    expect(await run([bunExe(), "main.mjs"], cwd)).toEqual({ stdout: plain, stderr: "", exitCode: 0 });
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "out/program"], cwd);
    expect({
      warns: built.stderr.includes("TS100064"),
      saysWhy: built.stderr.includes("TS100089: The executable doesn't embed ./"),
      exitCode: built.exitCode,
    }).toEqual({ warns: true, saysWhy: true, exitCode: 0 });
    for (const file of Object.keys({ ...shared, ...files })) rmSync(join(cwd, file));
    const ran = await run([join(cwd, "out", "program")], join(cwd, "out"));
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: said, exitCode: 1 });
    expect(ran.stderr).toContain(`Cannot find module '${missing}'`);
  });
}

// The name of the Worker's file climbs above the folder of main.mjs, so the build settles how many folders above it the executable holds. The guessed file lies higher still.
test("a guessed file lies above the folders that the executable holds", async () => {
  using dir = tempDir("a-file-that-the-build-only-guesses", {
    "above.cjs": `module.exports = 1;\n`,
    "outer/inner/package.json": `{ "name": "cell", "type": "module" }\n`,
    "outer/inner/worker.mjs": `postMessage("up");\nexport {};\n`,
    "outer/inner/deep/starts.mjs": `export function start(go) {\n  if (!go) return;\n  return new Worker(new URL("../../inner/worker.mjs", import.meta.url));\n}\nstart(false);\n`,
    "outer/inner/main.mjs": `import "./deep/starts.mjs";\nconst table = { above: "../../above.cjs" };\nexport const seen = JSON.stringify(table);\nfunction load(go) {\n  if (!go) return;\n  return import.meta.require(table.above);\n}\nload(false);\nconsole.log("SAID end");\n`,
  });
  const cwd = join(String(dir), "outer", "inner");
  const plain = { stdout: "SAID end\n", stderr: "", exitCode: 0 };
  expect(await run([bunExe(), "main.mjs"], cwd)).toEqual(plain);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "out/program"], cwd);
  expect({ warns: built.stderr.includes("TS100064"), exitCode: built.exitCode }).toEqual({ warns: true, exitCode: 0 });
  expect(await run([join(cwd, "out", "program")], join(cwd, "out"))).toEqual(plain);
});

test("the build names the file that doesn't say what it is", async () => {
  using dir = tempDir("a-file-that-the-build-only-guesses", { ...shared, ...Object.values(cases)[0].files });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "out/program"],
    String(dir),
  );
  expect(built.stderr).toContain(
    `TS100089: The executable doesn't embed ./part.mjs, which this path may name. "silent.cjs" doesn't say whether it's CommonJS or an ES module`,
  );
});
