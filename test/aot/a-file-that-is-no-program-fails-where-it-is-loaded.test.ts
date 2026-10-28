// Nothing says what a file holds whose name has no extension, or one that no loader has. `bun run` reads it as code where the program requires it, and, without an extension, where the program imports it.
// Where the file is no code the load fails: `require` throws, `import()` rejects, and a module that imports it does not load. A package that looks for a shared library under several names requires each inside a `try`.
// `bun run --aot`, which checks the program as a build does, and `bun run --debug-aot`, which runs compiled code in place of the files, do the same: each program prints what it prints under `bun run`, and ends alike.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const contents: Record<string, string> = {
  "a shared library": "\x7fELF\x02\x01\x01\0\0\0\0\0\0\0\0\0\x03\0>\0\x01\0\0\0(\0)\0,\n\0`${\0'\"\0/*\0",
  "prose": "this is no program at all (\n",
  "one wrong token": "const = 1;\n",
  "nothing": "",
  "a program": "module.exports = 41 + 1;\n",
};

const describeError = `function describe(error) {
  const all = error instanceof AggregateError ? [error, ...error.errors] : [error];
  return all.map(it => [it.constructor.name, it.name, it instanceof Error, it.code, String(it.message).replaceAll(process.cwd(), "."), it.position?.line, it.position?.column].join(" ")).join("; ");
}
`;

const ways: Record<string, (name: string) => Record<string, string>> = {
  "require in a try": name => ({
    "main.cjs": `${describeError}
for (let turn = 0; turn < 2; turn++) {
  try { console.log("loaded", JSON.stringify(require("./${name}"))); } catch (error) { console.log("caught", describe(error)); }
}
console.log("goes on");
`,
  }),
  "require in a package": name => ({
    "main.cjs": `console.log(require("finds-its-library"));\n`,
    "node_modules/finds-its-library/package.json": `{ "name": "finds-its-library", "version": "1.0.0", "main": "./index.js" }`,
    "node_modules/finds-its-library/index.js": `let found = "none";
for (const load of [() => require("./absent/${name}"), () => require("../../${name}")]) {
  try { found = typeof load(); break; } catch {}
}
module.exports = found;
`,
  }),
  "require that nothing catches": name => ({
    "main.cjs": `console.log("starts");\nconsole.log("loaded", JSON.stringify(require("./${name}")));\n`,
  }),
  "import() with a handler": name => ({
    "main.mjs": `${describeError}
console.log("starts");
await import("./${name}").then(it => console.log("loaded", typeof it.default), error => console.log("caught", describe(error)));
console.log("goes on");
`,
  }),
  "import": name => ({
    "main.mjs": `import "./first.mjs";\nimport "./${name}";\nconsole.log("loaded");\n`,
    "first.mjs": `console.log("first");\n`,
  }),
  "import in a module that is loaded later": name => ({
    "main.mjs": `${describeError}
console.log("starts");
await import("./later.mjs").then(() => console.log("loaded"), error => console.log("caught", describe(error)));
console.log("goes on");
`,
    "later.mjs": `import "./first.mjs";\nimport "./${name}";\nconsole.log("later");\n`,
    "first.mjs": `console.log("first");\n`,
  }),
};

async function expectSameAsPlain(folder: string, entry: string) {
  const [plain, checked, compiled] = await Promise.all(
    [[], ["--aot"], ["--debug-aot"]].map(flags => run([bunExe(), "run", ...flags, entry], folder)),
  );
  const expected = { stdout: plain.stdout, exitCode: plain.exitCode };
  expect({ stdout: checked.stdout, exitCode: checked.exitCode }).toEqual(expected);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual(expected);
}

describe.each(["library.so", "library"])("%s holds", name => {
  describe.each(Object.keys(contents))("%s:", held => {
    test.concurrent.each(Object.keys(ways))(
      "%s",
      async way => {
        const tree = ways[way](name);
        using dir = tempDir("no-program", { ...tree, [name]: contents[held] });
        const entry = "main.cjs" in tree ? "main.cjs" : "main.mjs";
        await expectSameAsPlain(String(dir), entry);
      },
      120_000,
    );
  });
});

describe.each(["library.so", "library"])("%s is a folder:", name => {
  test.concurrent.each(Object.keys(ways))(
    "%s",
    async way => {
      const tree = ways[way](name);
      using dir = tempDir("no-program", { ...tree, [name + "/held.txt"]: "text" });
      const entry = "main.cjs" in tree ? "main.cjs" : "main.mjs";
      await expectSameAsPlain(String(dir), entry);
    },
    120_000,
  );
});
