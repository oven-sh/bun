// `require("/etc/app/config.json")`: a whole path, written out, to a file that is not in the executable. The file is read when the program asks for it and is
// kept in `require.cache`, as in `bun <file>`: taken out of there, it is read again. Each case prints what `bun <the main file>` prints.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const twice = (load: string) =>
  `const load = () => { ${load} };\nwrite(1);\nconst one = load();\nwrite(2);\nconsole.log(one, load());\n`;

type Case = { main: string; text: (path: string) => string; prints: string };
const cases: Record<string, Case> = {
  "the key written out": {
    main: "main.cjs",
    text: path => twice(`delete require.cache[${path}]; return require(${path}).n;`),
    prints: "1 2\n",
  },
  "the key by require.resolve": {
    main: "main.cjs",
    text: path => twice(`delete require.cache[require.resolve(${path})]; return require(${path}).n;`),
    prints: "1 2\n",
  },
  "the key in a variable": {
    main: "main.cjs",
    text: path => `const key = ${path};\n${twice(`delete require.cache[key]; return require(${path}).n;`)}`,
    prints: "1 2\n",
  },
  "the free require of an ES module": {
    main: "main.mjs",
    text: path => twice(`delete require.cache[${path}]; return require(${path}).n;`),
    prints: "1 2\n",
  },
  "nothing is taken out": { main: "main.cjs", text: path => twice(`return require(${path}).n;`), prints: "1 1\n" },
  "two loads are one object": {
    main: "main.cjs",
    text: path => `write(1);\nconsole.log(require(${path}) === require(${path}));\n`,
    prints: "true\n",
  },
  "a change to what was loaded stays": {
    main: "main.cjs",
    text: path => `write(1);\nrequire(${path}).n = 5;\nconsole.log(require(${path}).n);\n`,
    prints: "5\n",
  },
  "not there, and then there": {
    main: "main.cjs",
    text: path =>
      `let one;\ntry {\n  one = require(${path}).n;\n} catch (error) {\n  one = error.code;\n}\nwrite(7);\nconsole.log(one, require(${path}).n);\n`,
    prints: "MODULE_NOT_FOUND 7\n",
  },
  "imported first, then taken out": {
    main: "main.mjs",
    text: path =>
      `write(1);\nconst one = (await import(${path})).default.n;\nwrite(2);\ndelete require.cache[${path}];\nconsole.log(one, require(${path}).n);\n`,
    prints: "1 2\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { main, text, prints } = cases[name];
  using outside = tempDir("aot-a-file-outside-the-executable", {});
  const file = join(String(outside), "config.json");
  const path = JSON.stringify(file);
  const fs = main.endsWith(".mjs") ? `import fs from "node:fs";\n` : `const fs = require("node:fs");\n`;
  const head = `${fs}fs.rmSync(${path}, { force: true });\nconst write = n => fs.writeFileSync(${path}, JSON.stringify({ n }));\n`;
  using sources = tempDir("aot-a-file-outside-the-executable-sources", { [main]: head + text(path) });
  using elsewhere = tempDir("aot-a-file-outside-the-executable-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const built = await run([bunExe(), "build", "--compile", "--aot", main, "--outfile", executable], String(sources));
  expect(built.exitCode).toBe(0);
  const plain = await run([bunExe(), main], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const compiled = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
});
