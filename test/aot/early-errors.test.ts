import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { beforeAll, describe, eachRow, gap, test } from "./supported";

// An early error of the language stops bun run before the first statement runs. Bun's parser reports some. These are reported by JavaScriptCore's, when it is
// handed the transpiled module. A compiled program is never handed to it, so the build reports them: the type checker finds them in every file, typed or
// not, and names the file and the line of the source. The words are the checker's, not those of bun run.
async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { stdout, stderr, exitCode };
}

function syntaxErrorOf(stderr: string) {
  return stderr.match(/SyntaxError: .*/)?.[0];
}

async function expectEarlyError(file: string, source: string, line: number, ...buildFlags: string[]) {
  using dir = tempDir("aot-early-errors", { [file]: source });
  const cwd = String(dir);
  const plain = await run(cwd, "run", `./${file}`);
  expect({ error: syntaxErrorOf(plain.stderr), stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({
    error: expect.any(String),
    stdout: "",
    exitCode: 1,
  });
  const location = new RegExp(`${file.replace(".", "\\.")}:${line}:\\d+$`);
  const said: string[][] = [];
  for (const args of [
    ["run", "--debug-aot", `./${file}`],
    ["build", "--compile", "--aot", ...buildFlags, `./${file}`, "--outfile", "app"],
  ]) {
    const { stdout, stderr, exitCode } = await run(cwd, ...args);
    expect({ args, stdout: args[0] === "run" ? stdout : "", exitCode }).toEqual({ args, stdout: "", exitCode: 1 });
    const errors = stderr.match(/^error\b.*/gm) ?? [];
    expect(errors.filter(error => !/^error: TS\d+: \S/.test(error))).toEqual([]);
    const locations = stderr.match(/^\s+at .*$/gm) ?? [];
    expect(locations.filter(printed => !location.test(printed))).toEqual([]);
    expect({ args, errors: errors.length > 0, locations: locations.length > 0 }).toEqual({
      args,
      errors: true,
      locations: true,
    });
    said.push(errors);
  }
  expect(said[1]).toEqual(said[0]);
  return said[0];
}

describe.concurrent("an early error that only JavaScriptCore reports stops the build at the line of the source", () => {
  test("the line is that of the TypeScript source", async () => {
    const source = `interface Point {\n  x: number;\n  y: number;\n}\ntype Name = string;\nconst never: string = "never printed";\nfunction unused(point: Point, name: Name): RegExp {\n  return /(?<n>a)(?<n>b)/;\n}\nconsole.log(unused);\n`;
    await expectEarlyError("main.ts", source, 8);
  });

  test("the line is that of the source under --minify", async () => {
    await expectEarlyError(
      "main.js",
      `console.log("never printed");\n\n\nfunction unused() {\n  return /[b-a]/;\n}\nconsole.log(unused);\n`,
      5,
      "--minify",
    );
  });

  test("the name is that of the source under --minify-identifiers", async () => {
    const errors = await expectEarlyError(
      "main.js",
      `console.log("never printed");\nvar both; function both() {} both;\nconsole.log("never printed");\n`,
      2,
      "--minify-identifiers",
    );
    expect(errors[0]).toContain("'both'");
  });

  test("in a module that is imported", async () => {
    using dir = tempDir("aot-early-errors", {
      "main.ts": `import { value } from "./imported";\nconsole.log("never printed", value);\n`,
      "imported.ts": `export const value: number = 1;\n\nclass Unused { constructor() {} constructor() {} }\n`,
    });
    const cwd = String(dir);
    const expected = syntaxErrorOf((await run(cwd, "run", "./main.ts")).stderr);
    expect(expected).toBe("SyntaxError: Cannot declare multiple constructors in a single class.");
    for (const args of [
      ["run", "--debug-aot", "./main.ts"],
      ["build", "--compile", "--aot", "./main.ts", "--outfile", "app"],
    ]) {
      const { stderr, exitCode } = await run(cwd, ...args);
      expect({ args, errors: (stderr.match(/^error\b.*/gm) ?? []).length > 0, exitCode }).toEqual({
        args,
        errors: true,
        exitCode: 1,
      });
      expect(stderr).toMatch(/imported\.ts:3:\d+/);
    }
  });

  test("in a CommonJS module", async () => {
    await expectEarlyError(
      "main.cjs",
      `module.exports = 1;\nconsole.log("never printed");\nfunction unused() { return /(?<n>a)(?<n>b)/; } console.log(unused);\n`,
      3,
    );
  });
});

// The early errors of strict mode code come from Bun's parser under bun run, and from the type checker in a build. Sloppy mode code
// has syntax that neither may report. Each row starts under both or under neither. A row in gap() does not yet: the words say what
// happens today. A row is a title, where the file is (a folder with a package.json, then the extension) and its code.
describe("strict mode code and sloppy mode code start under bun run and in a build alike", () => {
  const startMark = "globalThis.started = true;";
  // What bun build --format=cjs --target=bun writes around a file. Bun hands such a text to JavaScriptCore as it is.
  const writtenAsCommonJS = (body: string) =>
    `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {${body}\n})`;
  const rows = [
    ["a legacy octal escape in sloppy code", "cjs", `value = "\\1".length;`],
    [
      "a legacy octal escape before the end of a string in sloppy code",
      "cjs",
      `value = "a\\04".length + "\\08".length;`,
    ],
    ["a legacy octal number in sloppy code", "cjs", `value = 010;`],
    ["a repeated parameter in sloppy code", "cjs", `function f(a, a) { return a; } value = f(1, 2);`],
    ["an assignment to eval in sloppy code", "cjs", `function f() { eval = 1; } value = typeof f;`],
    [
      "an assignment to arguments in sloppy code",
      "cjs",
      `function f() { arguments = 1; return arguments; } value = f();`,
    ],
    ["a with statement in sloppy code", "cjs", `with ({ v: 1 }) value = v;`],
    ["delete of a name in sloppy code", "cjs", `var x = 1; value = delete x;`],
    ["a legacy HTML comment in sloppy code", "cjs", `value = 1 <!-- c\n;`],
    ["a closing legacy HTML comment in sloppy code", "cjs", `value = 1;\n--> c\n`],
    // A legacy HTML comment between two tokens hides no error of the tokens, and makes none.
    ["a legacy HTML comment behind a rest parameter that is not the last", "cjs", `function f(... <!-- c\na, b) {}`],
    ["a closing legacy HTML comment behind a rest parameter with a comma", "cjs", `function f(...a\n--> c\n,) {}`],
    [
      "a legacy HTML comment between for and await outside an async function",
      "cjs",
      `function f() { for <!-- c\nawait (const a of []) {} }`,
    ],
    ["a legacy HTML comment that ends in <> in front of parameters", "cjs", `function f <!-- <>\n() {} value = f();`],
    gap("the build reports TS1487, and bun run writes the character", [
      "a legacy octal escape in an untagged template in sloppy code",
      "cjs",
      "value = `\\033[1m`.length;",
    ] as const),
    ["a legacy octal number in a module", "mjs", `export const n = 010;`],
    ["a legacy octal escape in a module", "mjs", `export const s = "\\033[1m";`],
    ["a legacy octal number under a directive", "cjs", `"use strict"; value = 010;`],
    ["a legacy octal escape in a class", "cjs", `class A { m() { return "\\101"; } } value = new A().m();`],
    gap("the build reports TS1487, and bun run writes the character", [
      "a legacy octal escape in an untagged template in a module",
      "mjs",
      "export const s = `\\033[1m`;",
    ] as const),
    ["a function as the body of if in a module", "mjs", `if (true) function f() {}\nexport {};`],
    ["a function as the body of if under a directive", "cjs", `"use strict"; if (true) function f() {}`],
    ["a function as the body of a label in a module", "mjs", `x: function f() {}\nexport {};`],
    ["an initializer in a for-in loop in a module", "mjs", `for (var i = 0 in {}) ;\nexport {};`],
    ["an initializer in a for-in loop under a directive", "cjs", `"use strict"; for (var i = 0 in {}) ;`],
    ["two functions of one name at the top of a module", "mjs", `function f() {} function f() {}\nexport {};`],
    [
      "two functions of one name in a block under a directive",
      "cjs",
      `"use strict"; { function f() {} function f() {} }`,
    ],
    [
      "two functions of one name in a block in a class",
      "cjs",
      `class A { m() { { function f() {} function f() {} } } }`,
    ],
    ["a with statement in a module", "mjs", `with ({ v: 1 }) v;\nexport {};`],
    ["a with statement under a directive", "cjs", `"use strict"; with ({ v: 1 }) v;`],
    ["delete of a name in a module", "mjs", `var x = 1; delete x;\nexport {};`],
    ["delete of a constant under a directive", "cjs", `"use strict"; const x = 1; delete x;`],
    ["a repeated parameter in a module", "mjs", `function f(a, a) {}\nexport {};`],
    ["an assignment to eval in a module", "mjs", `eval = 1;\nexport {};`],
    ["a declaration named arguments in a module", "mjs", `var arguments = 1;\nexport {};`],
    ["a reserved word as the name of a variable in a module", "mjs", `var static = 1;\nexport {};`],
    [
      "a reserved word as the name of a function expression in a module",
      "mjs",
      `(function protected() {});\nexport {};`,
    ],
    ["a reserved word as a label in a module", "mjs", `static: for (;;) break static;\nexport {};`],
    ["a legacy HTML comment in a module", "mjs", `var a = 1 <!-- c\n;\nexport {};`],
    ["a closing legacy HTML comment in a module", "mjs", `var a = 1;\n--> c\nexport {};`],

    // What makes code strict for the parser of bun run: import, export or a top-level await, a directive, a class.
    ["a function as the body of if after an import", "mjs", `import "node:fs";\nif (true) function f() {}`],
    ["a function as the body of if after a top-level await", "mjs", `await 0;\nif (true) function f() {}`],
    [
      "a function as the body of if after a for await loop",
      "mjs",
      `for await (const x of []) ;\nif (true) function f() {}`,
    ],
    [
      "a function as the body of if in a function with a directive",
      "cjs",
      `function g() { "use strict"; if (true) function f() {} }`,
    ],
    ["a function as the body of else in a class", "cjs", `class A { m() { if (true) ; else function f() {} } }`],
    ["a function as the body of a label in a class", "cjs", `class A { m() { x: function f() {} } }`],
    [
      "a function as the body of if in what a class extends",
      "cjs",
      `class A extends (function () { if (true) function f() {} }) {}`,
    ],
    [
      "an initializer in a for-in loop in a function with a directive",
      "cjs",
      `function g() { "use strict"; for (var i = 0 in {}) ; }`,
    ],
    ["an initializer in a for-in loop in a class", "cjs", `class A { m() { for (var i = 0 in {}) ; } }`],
    ["an initializer in a for-in loop after an import", "mjs", `import "node:fs";\nfor (var i = 0 in {}) ;`],
    ["two functions of one name after an import", "mjs", `import "node:fs";\nfunction f() {} function f() {}`],
    ["two functions of one name after a top-level await", "mjs", `await 0;\nfunction f() {} function f() {}`],
    [
      "two functions of one name with a var between them in a module",
      "mjs",
      `function f() {} var f; function f() {}\nexport {};`,
    ],
    ["two exported functions of one name", "mjs", `export function f() {} export function f() {}`],
    [
      "two functions of one name in a case of a switch under a directive",
      "cjs",
      `"use strict"; switch (0) { case 0: function f() {} function f() {} }`,
    ],
    [
      "two functions of one name in a block in a function with a directive",
      "cjs",
      `function g() { "use strict"; { function f() {} function f() {} } }`,
    ],

    // A file that only runs as a module is sloppy mode code to that parser, and what it prints is valid in a module.
    ["a function as the body of if in a .mjs file with no import or export", "mjs", `if (true) function f() {}`],
    ["a function as the body of a label in a .mjs file with no import or export", "mjs", `x: function f() {}`],
    ["a function as the body of if beside import.meta", "mjs", `import.meta.url;\nif (true) function f() {}`],
    [
      "a function as the body of if in the key of a method with a directive",
      "cjs",
      `({ [(() => { if (true) function f() {} })()]() { "use strict"; } });`,
    ],
    ["an initializer in a for-in loop in a .mjs file with no import or export", "mjs", `for (var i = 0 in {}) ;`],
    ["an initializer in a for-in loop in sloppy code", "cjs", `for (var i = 0 in {}) ;`],
    ["two functions of one name in a .mjs file with no import or export", "mjs", `function f() {} function f() {}`],
    [
      "two functions of one name in a block in a .mjs file with no import or export",
      "mjs",
      `{ function f() {} function f() {} }`,
    ],
    [
      "two functions of one name in the body of a function under a directive",
      "cjs",
      `"use strict"; function g() { function f() {} function f() {} }`,
    ],
    [
      "two functions of one name in a static block of a class",
      "cjs",
      `class A { static { function f() {} function f() {} } }`,
    ],
    [
      "two functions of one name at the top of a CommonJS file under a directive",
      "cjs",
      `"use strict"; function f() {} function f() {}`,
    ],
    ["two functions of one name in a block in sloppy code", "cjs", `{ function f() {} function f() {} }`],

    // A legacy HTML comment is an error in a module. Which file is one: import, export or a top-level await says so, then CommonJS
    // syntax says no, then the name of the file and its package.json decide. Strict mode code has nothing to do with it.
    ["a legacy HTML comment in a .mjs file with no import or export", "mjs", `var a = 1 <!-- c\n;`],
    ["a closing legacy HTML comment in a .mjs file with no import or export", "mjs", `var a = 1;\n--> c`],
    ["a closing legacy HTML comment at the start of a .mjs file", "mjs", `--> c\n${startMark}`],
    ["a legacy HTML comment in a .mjs file with module.exports", "mjs", `module.exports = 1 <!-- c\n;`],
    ["a legacy HTML comment under a directive", "cjs", `"use strict"; var a = 1 <!-- c\n;`],
    ["a legacy HTML comment in a class", "cjs", `class A { m() { return 1 <!-- c\n; } }`],
    ["a closing legacy HTML comment in a .cjs file with export", "cjs", `var a = 1;\n--> c\nexport {};`],
    ["a legacy HTML comment in a .cjs file with import", "cjs", `import "node:fs";\nvar a = 1 <!-- c\n;`],
    ["a legacy HTML comment in a .js file", "js", `var a = 1 <!-- c\n;`],
    ["a legacy HTML comment beside import.meta in a .js file", "js", `import.meta.url;\nvar a = 1 <!-- c\n;`],
    [
      "a legacy HTML comment beside import.meta and require in a .js file",
      "js",
      `import.meta.url; require("node:fs");\nvar a = 1 <!-- c\n;`,
    ],
    ["a closing legacy HTML comment in a .jsx file", "jsx", `var a = 1;\n--> c`],
    ["a legacy HTML comment in a .js file of a module package", "module/js", `var a = 1 <!-- c\n;`],
    ["a closing legacy HTML comment in a .js file of a module package", "module/js", `var a = 1;\n--> c`],
    ["a legacy HTML comment in a .js file of a module package with exports", "module/js", `exports.a = 1 <!-- c\n;`],
    ["a legacy HTML comment in a .cjs file of a module package", "module/cjs", `var a = 1 <!-- c\n;`],
    ["a legacy HTML comment in a .js file of a CommonJS package", "commonjs/js", `var a = 1 <!-- c\n;`],
    [
      "a legacy HTML comment beside import.meta in a .js file of a CommonJS package",
      "commonjs/js",
      `import.meta.url;\nvar a = 1 <!-- c\n;`,
    ],
    [
      "two minus signs and a greater-than sign in one line of a module",
      "mjs",
      `var a = 2, b = 1; a --> b;\nexport {};`,
    ],

    // No parser of Bun reads a file that bun build wrote: JavaScriptCore reads it, and to it a module is strict mode code.
    ["a function as the body of if in a module that bun build wrote", "mjs", `// @bun\nif (true) function f() {}`],
    ["an initializer in a for-in loop in a module that bun build wrote", "mjs", `// @bun\nfor (var i = 0 in {}) ;`],
    ["two functions of one name in a module that bun build wrote", "mjs", `// @bun\nfunction f() {} function f() {}`],
    [
      "two functions of one name in a block of a module that bun build wrote",
      "mjs",
      `// @bun\n{ function f() {} function f() {} }`,
    ],
    ["a closing legacy HTML comment in a module that bun build wrote", "mjs", `// @bun\nvar a = 1;\n--> c`],
    gap("the build reports TS1127, and JavaScriptCore reads a comparison with !--c", [
      "a legacy HTML comment in a module that bun build wrote",
      "mjs",
      `// @bun\nvar c = 1; var a = 1 <!-- c\n;`,
    ] as const),
    [
      "a function as the body of if in a CommonJS file that bun build wrote",
      "cjs",
      writtenAsCommonJS(`${startMark}\nif (true) function f() {}`),
    ],
    [
      "a function as the body of if under a directive in a CommonJS file that bun build wrote",
      "cjs",
      writtenAsCommonJS(`"use strict";${startMark}\nif (true) function f() {}`),
    ],
    [
      "two functions of one name in a block under a directive in a CommonJS file that bun build wrote",
      "cjs",
      writtenAsCommonJS(`"use strict";${startMark}\n{ function f() {} function f() {} }`),
    ],
    [
      "a legacy HTML comment in a CommonJS file that bun build wrote",
      "cjs",
      writtenAsCommonJS(`${startMark}\nvar a = 1 <!-- c\n;`),
    ],

    // The parser of bun run reads TypeScript by the same rules.
    ["a function as the body of if in a TypeScript module", "ts", `if (true) function f() {}\nexport {};`],
    ["a function as the body of if in a .mts file with no import or export", "mts", `if (true) function f() {}`],
    [
      "a function as the body of if behind an import of a value in TypeScript",
      "ts",
      `import { d } from "./dep";\nif (true) function f() {}\nglobalThis.d = d;`,
    ],
    [
      "two functions of one name behind export as namespace",
      "ts",
      `// @ts-nocheck\n${startMark}\nexport as namespace NS;\nfunction f() {} function f() {}`,
    ],
  ] as const;

  // One process loads every file, and one reads them all for a build.
  const startsUnderBunRun = new Map<string, boolean>();
  const startsInABuild = new Map<string, boolean>();
  beforeAll(async () => {
    const files: Record<string, string> = {
      "module/package.json": JSON.stringify({ type: "module" }),
      "commonjs/package.json": JSON.stringify({ type: "commonjs" }),
      "dep.ts": `export const d = 1;\n`,
    };
    const names = rows.map(([, where, code], index) => {
      const name = where.replace(/\w+$/, extension => `row${index}.${extension}`);
      // A directive stays the first statement, and the mark of bun build stays the first line.
      const first = code.match(/^(?:"use strict";|\/\/ @bun\n)/)?.[0] ?? "";
      files[name] = code.includes(startMark) ? `${code}\n` : `${first}${startMark}\n${code.slice(first.length)}\n`;
      return name;
    });
    files["load.cjs"] = `
      (async () => {
        const started = [];
        for (const name of ${JSON.stringify(names)}) {
          globalThis.started = false;
          try {
            name.endsWith(".cjs") ? require("./" + name) : await import("./" + name);
          } catch {}
          started.push(globalThis.started);
        }
        console.log(JSON.stringify(started));
      })();
    `;
    using dir = tempDir("aot-strict-and-sloppy", files);
    const [loaded, checked] = await Promise.all([
      run(String(dir), "load.cjs"),
      run(String(dir), "check", "--aot", "--all", "--no-pretty", ...names),
    ]);
    const started: boolean[] = JSON.parse(loaded.stdout);
    expect(started).toHaveLength(rows.length);
    const refused = new Set((checked.stdout + checked.stderr).match(/^(?:\w+\/)?row\d+\.\w+(?=\()/gm));
    rows.forEach(([title], index) => {
      startsUnderBunRun.set(title, started[index]);
      startsInABuild.set(title, !refused.has(names[index]));
    });
  });

  eachRow(rows)("%s", title => {
    expect({ run: startsUnderBunRun.get(title), build: startsInABuild.get(title) }).toEqual({
      run: expect.any(Boolean),
      build: startsUnderBunRun.get(title),
    });
  });
});

// The file that holds a legacy HTML comment is judged, by its own name, however it is loaded. Each program prints under bun run what
// it prints compiled, or stops under both.
// bun run erases a signature, so it is the body of nothing.
test("a TypeScript signature without a body as the body of if starts under bun run and in a build", async () => {
  using dir = tempDir("aot-early-errors", {
    "main.ts": `export {};\nif (1) function f(a: string): void;\nfunction f(a: any) {}\nconsole.log("ran");\n`,
  });
  const cwd = String(dir);
  for (const args of [
    ["run", "./main.ts"],
    ["run", "--debug-aot", "./main.ts"],
  ]) {
    const { stdout, exitCode } = await run(cwd, ...args);
    expect({ args, stdout, exitCode }).toEqual({ args, stdout: "ran\n", exitCode: 0 });
  }
});

// Bun's parser takes this import for one of a value, so the file is a module to it. The build reads an import of the type `as`, which proves
// nothing, and starts the program.
test.failing("a function as the body of if behind import { type as } stops bun run and a build alike", async () => {
  using dir = tempDir("aot-early-errors", {
    "main.ts": `import { type as } from "./dep";\nif (1) function f() {}\nconsole.log("ran");\n`,
    "dep.ts": `export interface as {}\n`,
  });
  const cwd = String(dir);
  const plain = await run(cwd, "run", "./main.ts");
  const compiled = await run(cwd, "run", "--debug-aot", "./main.ts");
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "", exitCode: 1 });
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "", exitCode: 1 });
});

describe.concurrent("a legacy HTML comment in a file that another file loads", () => {
  test("is an error in a .mjs file that is only imported", async () => {
    using dir = tempDir("aot-early-errors", {
      "main.mjs": `import "./imported.mjs";\nconsole.log("never printed");\n`,
      "imported.mjs": `var a = 1;\n--> c\n`,
    });
    const cwd = String(dir);
    const plain = await run(cwd, "run", "./main.mjs");
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    for (const args of [
      ["run", "--debug-aot", "./main.mjs"],
      ["build", "--compile", "--aot", "./main.mjs", "--outfile", "app"],
    ]) {
      const { stdout, stderr, exitCode } = await run(cwd, ...args);
      expect({
        args,
        errors: stderr.match(/^error\b.*/gm),
        locations: (stderr.match(/^\s+at .*$/gm) ?? []).map(printed => printed.replace(/^.*[\\/]/, "")),
        stdout: args[0] === "run" ? stdout : "",
        exitCode,
      }).toEqual({
        args,
        errors: [expect.stringMatching(/^error: TS1127: \S/)],
        locations: ["imported.mjs:2:1"],
        stdout: "",
        exitCode: 1,
      });
    }
  });

  test("is a comment in a script of a package", async () => {
    using dir = tempDir("aot-early-errors", {
      "main.cjs": `console.log(require("old-library"));\n`,
      "node_modules/old-library/package.json": JSON.stringify({ name: "old-library", main: "index.js" }),
      "node_modules/old-library/index.js": `<!-- for browsers that know no script\nvar answer = 42;\n--> the end\nmodule.exports = answer;\n`,
    });
    const cwd = String(dir);
    const plain = await run(cwd, "run", "./main.cjs");
    const compiled = await run(cwd, "run", "--debug-aot", "./main.cjs");
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "42\n", exitCode: 0 });
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      stdout: "42\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("fails the test file that imports it, and no other, in a compiled test run", async () => {
    using dir = tempDir("aot-early-errors", {
      "uses.test.mjs": `import { expect, test } from "bun:test";\nimport "./helper.mjs";\ntest("uses the helper", () => expect(globalThis.helped).toBe(true));\n`,
      "helper.mjs": `globalThis.helped = true;\n--> c\n`,
      "alone.test.mjs": `import { expect, test } from "bun:test";\ntest("stands alone", () => expect(1).toBe(1));\n`,
    });
    const cwd = String(dir);
    const counted = ({ stderr, exitCode }: { stderr: string; exitCode: number }) => ({
      counts: ["pass", "fail", "error"].map(word => stderr.match(new RegExp(`^ (\\d+) ${word}`, "m"))?.[1]),
      names: /helper\.mjs:[12]:1/.test(stderr),
      exitCode,
    });
    const expected = { counts: ["1", "1", "1"], names: true, exitCode: 1 };
    expect(counted(await run(cwd, "test"))).toEqual(expected);
    expect(counted(await run(cwd, "test", "--aot"))).toEqual(expected);
  });

  // Bun reads a file again for an import statement, also where a require() runs it first, and that reading is a module for its
  // `import.meta`. Whether the require() has run by then differs from run to run, so only the failure is expected of bun run. The
  // build compiles the one form that runs, which is CommonJS.
  test("runs in a build where require() loads the file before an import statement, and bun run stops at the import", async () => {
    using dir = tempDir("aot-early-errors", {
      "main.mjs": `import "./first.cjs";\nimport "./package/both.jsx";\nconsole.log("main done");\n`,
      "first.cjs": `require("./package/both.jsx");\n`,
      "package/package.json": JSON.stringify({ type: "commonjs" }),
      "package/both.jsx": `import.meta.url; require("./empty.cjs");\nvar a = 1 <!-- c\n;\nconsole.log("ran");\n`,
      "package/empty.cjs": `\n`,
    });
    const cwd = String(dir);
    const plain = await run(cwd, "run", "./main.mjs");
    const compiled = await run(cwd, "run", "--debug-aot", "./main.mjs");
    expect({
      errors: plain.stderr.match(/^error\b.*/gm),
      isDone: plain.stdout.includes("main done"),
      exitCode: plain.exitCode,
    }).toEqual({
      errors: ["error: Legacy HTML single-line comments are not allowed in ECMAScript modules"],
      isDone: false,
      exitCode: 1,
    });
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      stdout: "ran\nmain done\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A file with no extension is read as TypeScript, where `<!--` is three operators: the program would print "false 4". The build
  // reports that reading for the types of this text, and compiles nothing. With operands of type any it compiles that reading.
  test("is three operators to the build in a file with no extension, where bun run reads a comment", async () => {
    using dir = tempDir("aot-early-errors", {
      "tool": `var c = 5; var value = 1 <!-- c\n;\nconsole.log(value, c);\n`,
    });
    const cwd = String(dir);
    const plain = await run(cwd, "run", "./tool");
    const compiled = await run(cwd, "run", "--debug-aot", "./tool");
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "1 5\n", exitCode: 0 });
    expect({
      errors: (compiled.stderr.match(/^error\b.*/gm) ?? []).length > 0,
      stdout: compiled.stdout,
      exitCode: compiled.exitCode,
    }).toEqual({ errors: true, stdout: "", exitCode: 1 });
  });
});
