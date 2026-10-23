import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

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

// A function that nothing names is dropped by the bundler before anybody reads its body, with --aot and without: what is in it is no part of the program. So the functions here are named.
const programs: Record<string, string> = {
  "an invalid regular expression in a function that is never called": `function unused() { return /(?<n>a)(?<n>b)/; } console.log(unused);`,
  "an invalid regular expression that is used": `console.log(/[b-a]/.test("a"));`,
  "an invalid escape under the u flag": `function unused() { return /\\-/u; } console.log(unused);`,
  "two constructors": `class Unused { constructor() {} constructor() {} }`,
  "new.target outside of functions": `new.target;`,
  "return outside of functions": `return;`,
  "a label declared twice": `again: { again: { console.log(1); } }`,
  "let as the name of a variable": `var let = 1;`,
  "a reserved word of strict mode as the name of a variable": `var public = 1;`,
  "a reserved word of strict mode as the name of a class": `class static {}`,
  "a reserved word of strict mode as a parameter of an arrow function": `const unused = package => 1;`,
  "a reserved word of strict mode, escaped, as a shorthand property": `const unused = ({ pu\\u0062lic }) => {};`,
  "yield as an expression outside of generators": `yield;`,
  "yield as a label": `yi\\u0065ld: 1;`,
  "yield as a shorthand property": `for ({ yield } of [{}]);`,
  "delete of a variable in parentheses": `var variable; delete ((variable));`,
  "await as the name of a variable in a static block": `class Unused { static { var { await } = {}; } }`,
  "await as the name of a function in a static block": `class Unused { static { function await() {} } }`,
  "await as the name of a function in an async function": `async function unused() { function await() {} }`,
  "a keyword as the variable of a loop": `for (let in {}) {}`,
};

describe.concurrent("an early error that only JavaScriptCore reports stops the build at the line of the source", () => {
  for (const [name, statement] of Object.entries(programs)) {
    test(name, async () => {
      await expectEarlyError(
        "main.js",
        `// The error is on the third line.\nconsole.log("never printed");\n${statement}\nconsole.log("never printed");\n`,
        3,
      );
    });
  }

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

// The tree of such a text is one that no valid text has, so the file is reported and not compiled.
describe.concurrent("a private name of super in a class that stays in the program stops the build", () => {
  const texts: Record<string, string> = {
    "main.js": `export var Kept = class { #x() {} method() { super.#x(); } };`,
    "main.mjs": `var Kept = class extends Unknown { #x() {} method() { super.#x(); } };`,
    "main.cjs": `var Kept = class extends Unknown { #x = 1; method() { return super.#x; } };`,
  };
  for (const [file, text] of Object.entries(texts)) {
    test(file, async () => {
      using dir = tempDir("aot-early-errors", { [file]: `console.log("never printed");\n${text}\n` });
      const cwd = String(dir);
      const plain = await run(cwd, "run", `./${file}`);
      expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "", exitCode: 1 });
      for (const args of [
        ["run", "--debug-aot", `./${file}`],
        ["build", "--compile", "--aot", `./${file}`, "--outfile", "app"],
      ]) {
        const { stdout, stderr, exitCode } = await run(cwd, ...args);
        const errors = stderr.match(/^(error|panic)\b.*/gm);
        expect({ args, stdout: args[0] === "run" ? stdout : "", errors, exitCode }).toEqual({
          args,
          stdout: "",
          errors: ["error: TS1034: 'super' must be followed by an argument list or member access."],
          exitCode: 1,
        });
      }
    });
  }
});

test("what is valid in a CommonJS module and not in a module still builds and runs", async () => {
  using dir = tempDir("aot-early-errors", {
    "main.cjs": `var let = 1, public = 2, yield = 4;\nmodule.exports = let + public + yield;\nconsole.log(module.exports);\n`,
  });
  const cwd = String(dir);
  const plain = await run(cwd, "run", "./main.cjs");
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "7\n", exitCode: 0 });
  const compiled = await run(cwd, "run", "--debug-aot", "./main.cjs");
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "7\n", exitCode: 0 });
});

describe.concurrent("a name that --minify-identifiers hands out may be a name of the source", () => {
  const letters = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_"];
  const programs: Record<string, [source: string, output: string]> = {
    "two declarations": [
      `const first = exports.first = []\nconst s = exports.second = {}\nconsole.log(Object.keys(exports).join(), first.length, typeof s);\n`,
      "first,second 0 object\n",
    ],
    "every name of one letter": [
      `const first = exports.first = [];\nlet count = 0;\nconst add = (name, value) => { count++; first.push(name); return value; };\n` +
        letters
          .map((letter, index) => `const ${letter} = exports.member${index} = add("${letter}", ${index});\n`)
          .join("") +
        `console.log(count, first.join(""), ${letters.join(" + ")});\n`,
      `54 ${letters.join("")} 1431\n`,
    ],
  };
  for (const [name, [source, output]] of Object.entries(programs)) {
    for (const flags of [
      ["--minify-identifiers"],
      ["--minify"],
      ["--minify-identifiers", "--no-compile-function-source"],
    ]) {
      test(`${name}, ${flags.join(" ")}`, async () => {
        using dir = tempDir("aot-early-errors", { "main.cjs": source });
        const cwd = String(dir);
        const build = await run(cwd, "build", "--compile", "--aot", ...flags, "./main.cjs", "--outfile", "app");
        expect({ errors: build.stderr.match(/^error\b.*/gm), exitCode: build.exitCode }).toEqual({
          errors: null,
          exitCode: 0,
        });
        const { stdout, exitCode } = await runCommand([`${cwd}/app`], cwd);
        expect({ stdout, exitCode }).toEqual({ stdout: output, exitCode: 0 });
      });
    }
  }
});
