// A program may be nested, or chained, as deeply as whoever generated it pleased. The parser, the binder, the checker and the lowering
// each look at what is left of the real stack, so the build of such a program either succeeds or says that the code is nested too deeply,
// with exit code 1. It never ends by a signal, and never without a word. The same holds for `bun check`, which shares the front end,
// and for `bun test --aot`, which looks at the files of a run by walks of its own and leaves a file that is too deep to the loader.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const rows = (count: number, row: (index: number) => string) =>
  Array.from({ length: count }, (_, i) => row(i)).join("\n");
const declared = `declare const console: { log(...values: unknown[]): void };\n`;
// Each: the extension, the program that is `n` deep, and what that program prints.
const shapes: Record<string, [string, (n: number) => string, (n: number) => unknown]> = {
  "a sum": ["js", n => `let a = 1;\nconst x = a${" + a".repeat(n)};\nconsole.log(x);`, n => n + 1],
  "a sum of texts": ["js", n => `const x = "a"${' + "a"'.repeat(n)};\nconsole.log(x.length);`, n => n + 1],
  "a chain of &&": ["js", n => `let a = 1;\nconst x = a${" && a".repeat(n)};\nconsole.log(x);`, () => 1],
  "a chain of commas": ["js", n => `let a = 1;\nconst x = (a${", a".repeat(n)});\nconsole.log(x);`, () => 1],
  "calls": ["js", n => `const f = v => v;\nconst x = ${"f(".repeat(n)}0${")".repeat(n)};\nconsole.log(x);`, () => 0],
  "arrays": ["js", n => `const x = ${"[".repeat(n)}${"]".repeat(n)};\nconsole.log(x.length);`, n => (n > 1 ? 1 : 0)],
  "parentheses": ["js", n => `const x = ${"(".repeat(n)}1${")".repeat(n)};\nconsole.log(x);`, () => 1],
  "ternaries": ["js", n => `let c = 0;\nconst x = ${"c ? 1 : ".repeat(n)}2;\nconsole.log(x);`, () => 2],
  "templates": ["js", n => `const x = ${"`${".repeat(n)}1${"}`".repeat(n)};\nconsole.log(x);`, () => 1],
  "object literals": [
    "js",
    n => `const x = ${"{ next: ".repeat(n)}null${" }".repeat(n)};\nconsole.log(typeof x);`,
    () => "object",
  ],
  "else if": [
    "js",
    n => `let c = -1;\nif (c === 0) c = 0;\n${rows(n, i => `else if (c === ${i + 1}) c = ${i};`)}\nconsole.log(c);`,
    () => -1,
  ],
  "blocks": ["js", n => `${"{".repeat(n)}console.log(1);${"}".repeat(n)}`, () => 1],
  "ifs": ["js", n => `let c = 1;\n${"if (c) ".repeat(n)}console.log(c);`, () => 1],
  "loops": ["js", n => `let c = 0;\n${"while (c) ".repeat(n)}c = 0;\nconsole.log(c);`, () => 0],
  "loops round a sum": [
    "js",
    n =>
      `let left = 0;\nfunction more() { return left-- > 0; }\nfunction f() {\n  let sum = 0;\n  ${"while (more()) ".repeat(n)}sum += 1;\n  return sum;\n}\nconsole.log(f());`,
    () => 0,
  ],
  "arrow functions": ["js", n => `const x = ${"() => ".repeat(n)}0;\nconsole.log(typeof x);`, () => "function"],
  "functions": ["js", n => `${"function f() { ".repeat(n)}${"}".repeat(n)}\nconsole.log(typeof f);`, () => "function"],
  "members": ["js", n => `const a = {}; a.b = a;\nconst x = a${".b".repeat(n)};\nconsole.log(x === a);`, () => true],
  "optional members": [
    "js",
    n => `const a = {}; a.b = a;\nconst x = a${"?.b".repeat(n)};\nconsole.log(x === a);`,
    () => true,
  ],
  "fluent calls": [
    "js",
    n => `const a = { m() { return this; } };\nconst x = a${".m()".repeat(n)};\nconsole.log(x === a);`,
    () => true,
  ],
  "nots": ["js", n => `let a = 1;\nconst x = ${"!".repeat(n)}a;\nconsole.log(x);`, n => n % 2 === 0],
  "assignments": ["js", n => `let a;\n${"a = ".repeat(n)}1;\nconsole.log(a);`, () => 1],
  "classes": [
    "js",
    n => `const x = ${"class { static c = ".repeat(n)}0${" }".repeat(n)};\nconsole.log(typeof x);`,
    () => "function",
  ],
  "spreads": ["js", n => `const x = ${"[...".repeat(n)}[]${"]".repeat(n)};\nconsole.log(x.length);`, () => 0],
  "patterns": [
    "js",
    n => `const ${"[".repeat(n)}x${"]".repeat(n)} = ${"[".repeat(n)}1${"]".repeat(n)};\nconsole.log(x);`,
    () => 1,
  ],
  "labels": ["js", n => `${rows(n, i => `l${i}:`)}\nconsole.log(1);`, () => 1],
  "type arguments": [
    "ts",
    n =>
      `${declared}type T = ${"Array<".repeat(n)}number${">".repeat(n)};\nconst x = null as unknown as T;\nconsole.log(x);`,
    () => null,
  ],
  "array types": [
    "ts",
    n => `${declared}type T = number${"[]".repeat(n)};\nconst x = null as unknown as T;\nconsole.log(x);`,
    () => null,
  ],
  "object types": [
    "ts",
    n =>
      `${declared}type T = ${"{ a: ".repeat(n)}number${" }".repeat(n)};\nconst x = null as unknown as T;\nconsole.log(x);`,
    () => null,
  ],
  "a union": [
    "ts",
    n => `${declared}type T = 0${rows(n, i => ` | ${i + 1}`)};\nconst x = 0 as T;\nconsole.log(x);`,
    () => 0,
  ],
  "conditional types": [
    "ts",
    n => `${declared}type T<X> = ${"X extends 1 ? 1 : ".repeat(n)}2;\nconst x = 2 as T<0>;\nconsole.log(x);`,
    () => 2,
  ],
  "function types": [
    "ts",
    n => `${declared}type T = ${"() => ".repeat(n)}number;\nconst x = null as unknown as T;\nconsole.log(x);`,
    () => null,
  ],
  "casts": ["ts", n => `${declared}const x = 1${" as number".repeat(n)};\nconsole.log(x);`, () => 1],
  "aliases": [
    "ts",
    n =>
      `${declared}type T0 = number;\n${rows(n, i => `type T${i + 1} = T${i}[];`)}\nconst x = null as unknown as T${n};\nconsole.log(x);`,
    () => null,
  ],
  "constants": [
    "js",
    n => `const c0 = 1;\n${rows(n, i => `const c${i + 1} = c${i} + 1;`)}\nconsole.log(c${n});`,
    n => n + 1,
  ],
  "callers": [
    "js",
    n =>
      `function f0() { return 0; }\n${rows(n, i => `function f${i + 1}() { return f${i}() + 1; }`)}\nconsole.log(typeof f${n});`,
    () => "function",
  ],
};

async function ended(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdio: ["ignore", "pipe", "pipe"] });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

const succeeds = { stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0, signal: null };
const saysTooDeep =
  /TS100060: The code in ".*[\\/]deep\.(js|ts)" is nested too deeply to be compiled|TS100301: This code is nested more than \d+ levels deep/;
const checkSaysTooDeep =
  /the code in (deep|checked)\.(js|ts) is nested too deeply: errors in this file may be missing|ran out of stack in (deep|checked)\.(js|ts)/;

// Where the parser gave up: the file, the line and the column.
const saysWhere = /^\s+at .*deep\.(js|ts):\d+:\d+$/m;
// A chain is parsed in a loop, so a later walk of its tree is the first to give up, and that names the file alone.
const isParsedInALoop = new Set(["members", "optional members", "fluent calls", "casts", "array types"]);

// Every walk must bear this much, on every system and under a sanitizer.
const shallow = 500;
// Far beyond where any shape that nests is refused today: between 3,000 and 54,000 levels on Linux x64.
const deep = 200_000;
// It is compiled in full, which at `deep` takes twenty seconds of processor time.
// It is checked at `deep` and built at a depth at which every fault of this kind so far would have shown.
const builtLessDeep: Record<string, number> = {
  "callers": 50_000,
  // The front end bears it, and the engine follows the sum from the head of each loop to the head around it.
  "loops round a sum": 3_000,
};

// A build is what costs, and at `shallow` every shape is built: so one program loads the program of each shape as a module of its own,
// and one executable holds them all. Ahead of each goes a line with the name of its shape, and one that throws says so in its place.
test.concurrent(
  `every shape at ${shallow} levels, as the modules of one program`,
  async () => {
    const modules = Object.entries(shapes).map(([name, [extension, program, printed]]) => ({
      name,
      file: `${name.replaceAll(" ", "-")}.${extension}`,
      text: program(shallow) + "\n",
      printed: `${printed(shallow)}\n`,
    }));
    using dir = tempDir("aot-deep-programs-shallow", {
      "package.json": `{ "name": "p" }`,
      ...Object.fromEntries(modules.map(({ file, text }) => [file, text])),
      "all.mjs": modules
        .map(
          ({ name, file }) =>
            `console.log(${JSON.stringify(`shape: ${name}`)});\n` +
            `try {\n  await import("./${file}");\n} catch (error) {\n  console.log("threw " + error);\n}\n`,
        )
        .join(""),
    });
    const cwd = String(dir);
    const built = await ended([bunExe(), "build", "--compile", "--aot", "./all.mjs", "--outfile", "./all"], cwd);
    expect({ stderr: built.stderr, exitCode: built.exitCode, signal: built.signal }).toEqual(succeeds);
    const [plain, compiled] = await Promise.all([ended([bunExe(), "./all.mjs"], cwd), ended([join(cwd, "all")], cwd)]);
    const stdout = modules.map(({ name, printed }) => `shape: ${name}\n${printed}`).join("");
    expect({ ...plain, stderr: "" }).toEqual({ stdout, stderr: "", exitCode: 0, signal: null });
    expect(compiled).toEqual(plain);
  },
  600_000,
);

test.concurrent.each(Object.entries(shapes))(
  "%s",
  async (name, [extension, program]) => {
    using dir = tempDir("aot-deep-programs", {
      "package.json": `{ "name": "p" }`,
      [`deep.${extension}`]: program(builtLessDeep[name] ?? deep) + "\n",
      ...(name in builtLessDeep ? { [`checked.${extension}`]: program(deep) + "\n" } : {}),
    });
    const cwd = String(dir);

    const refused = await ended(
      [bunExe(), "build", "--compile", "--aot", `./deep.${extension}`, "--outfile", "./deep"],
      cwd,
    );
    // What succeeds leaves its executable, and what is refused leaves none.
    expect({
      stderr: refused.stderr,
      executable: existsSync(join(cwd, isWindows ? "deep.exe" : "deep")),
      exitCode: refused.exitCode,
      signal: refused.signal,
    }).toEqual(
      refused.exitCode === 0
        ? { ...succeeds, executable: true }
        : { stderr: expect.stringMatching(saysTooDeep), executable: false, exitCode: 1, signal: null },
    );
    if (refused.exitCode !== 0 && !isParsedInALoop.has(name)) expect(refused.stderr).toMatch(saysWhere);

    const checked = await ended(
      [bunExe(), "check", `./${name in builtLessDeep ? "checked" : "deep"}.${extension}`],
      cwd,
    );
    expect({ said: checked.stdout + checked.stderr, exitCode: checked.exitCode, signal: checked.signal }).toEqual(
      checked.exitCode === 0
        ? { said: expect.stringContaining("No type errors in 1 file"), exitCode: 0, signal: null }
        : { said: expect.stringMatching(checkSaysTooDeep), exitCode: 1, signal: null },
    );
  },
  600_000,
);

// At `deep` the parser is the first to give up. What it still bears is the deepest that the walks behind it meet, and they bear less.
// Thirteen shapes once ended a test run by one panic, where the parser bore a file and the binder did not: each is here at every depth at which it did so on Linux x64.
// The files belong to the run and no test loads them: what the engine's own parser makes of them is another matter.
const onceEndedARun: Record<string, number[]> = {
  "object literals": [8_000],
  "arrow functions": [8_000],
  "functions": [8_000],
  "function types": [8_000, 16_000],
  "blocks": [16_000, 32_000],
  "fluent calls": [16_000, 32_000, 64_000],
  "optional members": [16_000, 32_000, 64_000],
  "members": [32_000, 64_000],
  "casts": [32_000, 64_000],
  "ternaries": [32_000],
  "nots": [32_000],
  "assignments": [32_000],
  "conditional types": [32_000],
};
test("the shapes that once ended a test run, as the files of one", async () => {
  const files: Record<string, string> = { "package.json": `{ "name": "p" }` };
  const loads: string[] = [];
  Object.entries(onceEndedARun).forEach(([name, depths], shape) => {
    const [extension, program] = shapes[name];
    for (const n of depths) {
      files[`shape-${shape}/deep-${n}.${extension}`] = program(n) + "\n";
      loads.push(`() => import("./shape-${shape}/deep-${n}.${extension}")`);
    }
  });
  files["deep.test.js"] =
    `import { expect, test } from "bun:test";\nconst loads = [\n${loads.join(",\n")},\n];\n` +
    `test("t", () => expect(loads.length).toBe(${loads.length}));\n`;
  using run = tempDir("aot-deep-programs-in-a-test-run", files);
  const ran = await ended([bunExe(), "test", "--aot"], String(run));
  expect(normalizeBunSnapshot(ran.stderr, String(run))).toMatchInlineSnapshot(`
    "deep.test.js:
    (pass) t

     1 pass
     0 fail
     1 expect() calls
    Ran 1 test across 1 file."
  `);
  expect({ exitCode: ran.exitCode, signal: ran.signal }).toEqual({ exitCode: 0, signal: null });
}, 600_000);
