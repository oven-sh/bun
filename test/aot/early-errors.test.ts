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
// happens today.
describe("strict mode code and sloppy mode code start under bun run and in a build alike", () => {
  const buildMisses = "bun run reports it, and the build compiles it";
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
    gap("the build reports TS1127, and bun run reads a comment", [
      "a legacy HTML comment in sloppy code",
      "cjs",
      `value = 1 <!-- c\n;`,
    ] as const),
    ["a closing legacy HTML comment in sloppy code", "cjs", `value = 1;\n--> c\n`],
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
    gap(buildMisses, [
      "a function as the body of if in a module",
      "mjs",
      `if (true) function f() {}\nexport {};`,
    ] as const),
    gap(buildMisses, [
      "a function as the body of if under a directive",
      "cjs",
      `"use strict"; if (true) function f() {}`,
    ] as const),
    gap(buildMisses, [
      "a function as the body of a label in a module",
      "mjs",
      `x: function f() {}\nexport {};`,
    ] as const),
    gap(buildMisses, [
      "an initializer in a for-in loop in a module",
      "mjs",
      `for (var i = 0 in {}) ;\nexport {};`,
    ] as const),
    gap(buildMisses, [
      "an initializer in a for-in loop under a directive",
      "cjs",
      `"use strict"; for (var i = 0 in {}) ;`,
    ] as const),
    gap(buildMisses, [
      "two functions of one name at the top of a module",
      "mjs",
      `function f() {} function f() {}\nexport {};`,
    ] as const),
    gap(buildMisses, [
      "two functions of one name in a block under a directive",
      "cjs",
      `"use strict"; { function f() {} function f() {} }`,
    ] as const),
    gap(buildMisses, [
      "two functions of one name in a block in a class",
      "cjs",
      `class A { m() { { function f() {} function f() {} } } }`,
    ] as const),
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
    gap("bun run reports it, and the build reads a comment", [
      "a closing legacy HTML comment in a module",
      "mjs",
      `var a = 1;\n--> c\nexport {};`,
    ] as const),
  ] as const;

  // One process loads every file, and one reads them all for a build.
  const startsUnderBunRun = new Map<string, boolean>();
  const startsInABuild = new Map<string, boolean>();
  beforeAll(async () => {
    const files: Record<string, string> = {};
    const names = rows.map(([, extension, code], index) => {
      const directive = code.startsWith('"use strict";') ? '"use strict";' : "";
      files[`row${index}.${extension}`] = `${directive}globalThis.started = true;\n${code.slice(directive.length)}\n`;
      return `row${index}.${extension}`;
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
    const refused = new Set((checked.stdout + checked.stderr).match(/^row\d+\.[cm]js(?=\()/gm));
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
