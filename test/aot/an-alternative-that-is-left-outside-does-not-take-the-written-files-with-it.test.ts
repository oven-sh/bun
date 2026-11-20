// `require(flag ? "left-out" : "./slow.cjs")`: a call that writes out its alternatives. One of them is a package left outside (`--external left-out`) or an
// address; the others are files of the program and are compiled in. Each case prints what `bun <the main file>` prints. The executable is started in another
// folder, which holds nothing but the package where the case says so, so no file of the program is found on disk.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const slow = { "slow.cjs": `exports.label = "slow";\nexports.touch = () => {};\n` };
const real = { "real.mjs": `export const a = 1;\nexport const b = 2;\n` };
const taken = `process.argv.length > 2 ? "left-out" : "./slow.cjs"`;
const outside = {
  "node_modules/left-out/package.json": `{ "name": "left-out", "main": "index.js" }\n`,
  "node_modules/left-out/index.js": `globalThis.planted = 1;\nexports.label = "from outside";\nexports.touch = holder => { holder.own = "changed"; holder.added = 2; };\n`,
};

type Case = {
  main: string;
  files: Record<string, string>;
  prints: string;
  flags?: string[];
  argument?: string;
  beside?: Record<string, string>;
};
const leftOut = ["--external", "left-out"];
const cases: Record<string, Case> = {
  "a package left outside or a file": {
    main: "main.cjs",
    files: {
      ...slow,
      "main.cjs": `console.log(require(process.argv.length > 99 ? "left-out" : "./slow.cjs").label);\n`,
    },
    flags: leftOut,
    prints: "slow\n",
  },
  "a file or a file": {
    main: "main.cjs",
    files: {
      ...slow,
      "fast.cjs": `exports.label = "fast";\n`,
      "main.cjs": `console.log(require(process.argv.length > 99 ? "./fast.cjs" : "./slow.cjs").label);\n`,
    },
    flags: leftOut,
    prints: "slow\n",
  },
  "the file is in for another importer": {
    main: "main.mjs",
    files: {
      ...real,
      "main.mjs": `import { a } from "./real.mjs";\nconst got = await import(process.argv.length > 99 ? "left-out" : "./real.mjs");\nconsole.log(a, got.b, Object.keys(got).sort().join());\n`,
    },
    flags: leftOut,
    prints: "1 2 a,b\n",
  },
  "beside a module of the library": {
    main: "main.cjs",
    files: {
      ...slow,
      "main.cjs": `const n = process.argv.length;\nconsole.log(require(n > 99 ? "node:fs" : n > 98 ? "left-out" : "./slow.cjs").label);\n`,
    },
    flags: leftOut,
    prints: "slow\n",
  },
  "an address or a file": {
    main: "main.mjs",
    files: {
      ...real,
      "main.mjs": `const got = await import(process.argv.length > 99 ? "https://made-up.invalid/x.js" : "./real.mjs");\nconsole.log(got.b);\n`,
    },
    prints: "2\n",
  },
  "out of a table": {
    main: "main.cjs",
    files: {
      ...slow,
      "main.cjs": `const table = { p: "left-out", q: "./slow.cjs" };\nconst key = process.argv.length > 99 ? "p" : "q";\nconsole.log(require(table[key]).label);\n`,
    },
    flags: leftOut,
    prints: "slow\n",
  },
  "the package is asked for and is there": {
    main: "main.cjs",
    files: {
      ...slow,
      ...outside,
      "main.cjs": `const holder = { own: 1 };\nconst got = require(${taken});\ngot.touch(holder);\nconsole.log(got.label, typeof globalThis.planted, holder.own, holder.added);\n`,
    },
    flags: leftOut,
    argument: "taken",
    beside: outside,
    prints: "from outside number changed 2\n",
  },
  "the package is asked for and is missing": {
    main: "main.cjs",
    files: {
      ...slow,
      "main.cjs": `let got;\ntry {\n  got = require(${taken}).label;\n} catch (error) {\n  got = "caught " + error.code;\n}\nconsole.log(got);\n`,
    },
    flags: leftOut,
    argument: "taken",
    prints: "caught MODULE_NOT_FOUND\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { main, files, prints, flags = [], argument, beside = {} } = cases[name];
  using sources = tempDir("aot-an-alternative-left-outside", files);
  using elsewhere = tempDir("aot-an-alternative-left-outside-run", beside);
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const given = argument ? [argument] : [];
  const plain = await run([bunExe(), main, ...given], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, main, "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable, ...given], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
});
