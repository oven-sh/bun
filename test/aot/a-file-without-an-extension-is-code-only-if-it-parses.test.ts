// A file whose name has no extension is code if it parses as code.
// `require(flag ? "./bin/cli" : "./other.js")`: both names are written out, so both files are in the executable, also the one without an extension.
// `createRequire(__filename)("./NOTICE")`: `bun build --compile` does not link that call, so nothing is carried for it: the call throws.
// Each case prints what `bun <the main file>` prints. The executable is started in an empty folder.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string | Buffer> = {
  "bin/cli": `globalThis.times = (globalThis.times ?? 0) + 1;\nexports.word = "cli";\n`,
  "other.js": `exports.word = "other";\n`,
  NOTICE: "this is a notice {, and no code\n",
  "bin/latin": Buffer.from(
    `// caf\xe9\nglobalThis.times = (globalThis.times ?? 0) + 1;\nexports.word = "latin";\n`,
    "latin1",
  ),
};
const flag = (whenNothingIsSaid: string) => `const flag = (process.argv[2] ?? "${whenNothingIsSaid}") === "cli";\n`;
const made = `const load = require("node:module").createRequire(__filename);\n`;
const sayKindOf = (load: string) =>
  `let said;\ntry {\n  said = typeof ${load};\n} catch {\n  said = "threw";\n}\nconsole.log(said);\n`;

const cases: Record<string, { text: string; prints: string }> = {
  "the arm without an extension is taken": {
    text: flag("cli") + `console.log(require(flag ? "./bin/cli" : "./other.js").word);\n`,
    prints: "cli\n",
  },
  "the other arm is taken": {
    text: flag("other") + `console.log(require(flag ? "./bin/cli" : "./other.js").word);\n`,
    prints: "other\n",
  },
  "a choice in import()": {
    text: flag("cli") + `import(flag ? "./bin/cli" : "./other.js").then(found => console.log(found.default.word));\n`,
    prints: "cli\n",
  },
  "the choice lies in a variable": {
    text: flag("cli") + `const name = flag ? "./bin/cli" : "./other.js";\nconsole.log(require(name).word);\n`,
    prints: "cli\n",
  },
  "the name stands alone": { text: `console.log(require("./bin/cli").word);\n`, prints: "cli\n" },
  "the arm without an extension is no code": {
    text: sayKindOf(`require(process.argv.length > 99 ? "./other.js" : "./NOTICE")`),
    prints: "threw\n",
  },
  "a made require of a file that is no code": { text: made + sayKindOf(`load("./NOTICE")`), prints: "threw\n" },
  "require under another name, of a file that is no code": {
    text: `const load = require;\n` + sayKindOf(`load("./NOTICE")`),
    prints: "threw\n",
  },
  "the next file is tried behind one that is no code": {
    text:
      made +
      `let found = "none";\nfor (const look of [() => load("./NOTICE"), () => load("./other.js")]) {\n  try {\n    found = look().word;\n    break;\n  } catch {}\n}\nconsole.log(found);\n`,
    prints: "other\n",
  },
  "a made require and a written one of code get one module": {
    text: made + `console.log(load("./bin/cli") === require("./bin/cli"), globalThis.times);\n`,
    prints: "true 1\n",
  },
  "so do they of code that is not UTF-8": {
    text: made + `console.log(load("./bin/latin") === require("./bin/latin"), globalThis.times);\n`,
    prints: "true 1\n",
  },
  "an arm that is not UTF-8 is taken": {
    text: flag("cli") + `console.log(require(flag ? "./bin/latin" : "./other.js").word);\n`,
    prints: "latin\n",
  },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { text, prints } = cases[name];
  using sources = tempDir("aot-a-file-without-an-extension", { ...files, "main.cjs": text });
  using elsewhere = tempDir("aot-a-file-without-an-extension-run", {});
  const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.cjs"], String(sources), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: prints, exitCode: 0 });
});
