// A program may be nested, or chained, as deeply as whoever generated it pleased. The parser, the binder, the checker and the lowering
// each look at what is left of the real stack, so the build of such a program either succeeds or says that the code is nested too deeply,
// with exit code 1. It never ends by a signal, and never without a word. The same holds for `bun check`, which shares the front end,
// and for `bun test --aot`, which looks at the files of a run by walks of its own and leaves a file that is too deep to the loader.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { partOfGrid } from "./harness/ways";
import { test } from "./supported";

const rows = (count: number, row: (index: number) => string) =>
  Array.from({ length: count }, (_, i) => row(i)).join("\n");
const declared = `declare const console: { log(...values: unknown[]): void };\n`;
// Each: the extension, and the program that is `n` deep.
const shapes: Record<string, [string, (n: number) => string]> = {
  "a sum": ["js", n => `let a = 1;\nconst x = a${" + a".repeat(n)};\nconsole.log(x);`],
  "a sum of texts": ["js", n => `const x = "a"${' + "a"'.repeat(n)};\nconsole.log(x.length);`],
  "a chain of &&": ["js", n => `let a = 1;\nconst x = a${" && a".repeat(n)};\nconsole.log(x);`],
  "a chain of commas": ["js", n => `let a = 1;\nconst x = (a${", a".repeat(n)});\nconsole.log(x);`],
  "calls": ["js", n => `const f = v => v;\nconst x = ${"f(".repeat(n)}0${")".repeat(n)};\nconsole.log(x);`],
  "arrays": ["js", n => `const x = ${"[".repeat(n)}${"]".repeat(n)};\nconsole.log(x.length);`],
  "parentheses": ["js", n => `const x = ${"(".repeat(n)}1${")".repeat(n)};\nconsole.log(x);`],
  "ternaries": ["js", n => `let c = 0;\nconst x = ${"c ? 1 : ".repeat(n)}2;\nconsole.log(x);`],
  "templates": ["js", n => `const x = ${"`${".repeat(n)}1${"}`".repeat(n)};\nconsole.log(x);`],
  "object literals": ["js", n => `const x = ${"{ next: ".repeat(n)}null${" }".repeat(n)};\nconsole.log(typeof x);`],
  "else if": [
    "js",
    n => `let c = -1;\nif (c === 0) c = 0;\n${rows(n, i => `else if (c === ${i + 1}) c = ${i};`)}\nconsole.log(c);`,
  ],
  "blocks": ["js", n => `${"{".repeat(n)}console.log(1);${"}".repeat(n)}`],
  "ifs": ["js", n => `let c = 1;\n${"if (c) ".repeat(n)}console.log(c);`],
  "arrow functions": ["js", n => `const x = ${"() => ".repeat(n)}0;\nconsole.log(typeof x);`],
  "functions": ["js", n => `${"function f() { ".repeat(n)}${"}".repeat(n)}\nconsole.log(typeof f);`],
  "members": ["js", n => `const a = {}; a.b = a;\nconst x = a${".b".repeat(n)};\nconsole.log(x === a);`],
  "optional members": ["js", n => `const a = {}; a.b = a;\nconst x = a${"?.b".repeat(n)};\nconsole.log(x === a);`],
  "fluent calls": [
    "js",
    n => `const a = { m() { return this; } };\nconst x = a${".m()".repeat(n)};\nconsole.log(x === a);`,
  ],
  "nots": ["js", n => `let a = 1;\nconst x = ${"!".repeat(n)}a;\nconsole.log(x);`],
  "assignments": ["js", n => `let a;\n${"a = ".repeat(n)}1;\nconsole.log(a);`],
  "classes": ["js", n => `const x = ${"class { static c = ".repeat(n)}0${" }".repeat(n)};\nconsole.log(typeof x);`],
  "spreads": ["js", n => `const x = ${"[...".repeat(n)}[]${"]".repeat(n)};\nconsole.log(x.length);`],
  "patterns": [
    "js",
    n => `const ${"[".repeat(n)}x${"]".repeat(n)} = ${"[".repeat(n)}1${"]".repeat(n)};\nconsole.log(x);`,
  ],
  "labels": ["js", n => `${rows(n, i => `l${i}:`)}\nconsole.log(1);`],
  "type arguments": [
    "ts",
    n =>
      `${declared}type T = ${"Array<".repeat(n)}number${">".repeat(n)};\nconst x = null as unknown as T;\nconsole.log(x);`,
  ],
  "array types": [
    "ts",
    n => `${declared}type T = number${"[]".repeat(n)};\nconst x = null as unknown as T;\nconsole.log(x);`,
  ],
  "object types": [
    "ts",
    n =>
      `${declared}type T = ${"{ a: ".repeat(n)}number${" }".repeat(n)};\nconst x = null as unknown as T;\nconsole.log(x);`,
  ],
  "a union": ["ts", n => `${declared}type T = 0${rows(n, i => ` | ${i + 1}`)};\nconst x = 0 as T;\nconsole.log(x);`],
  "conditional types": [
    "ts",
    n => `${declared}type T<X> = ${"X extends 1 ? 1 : ".repeat(n)}2;\nconst x = 2 as T<0>;\nconsole.log(x);`,
  ],
  "function types": [
    "ts",
    n => `${declared}type T = ${"() => ".repeat(n)}number;\nconst x = null as unknown as T;\nconsole.log(x);`,
  ],
  "casts": ["ts", n => `${declared}const x = 1${" as number".repeat(n)};\nconsole.log(x);`],
  "aliases": [
    "ts",
    n =>
      `${declared}type T0 = number;\n${rows(n, i => `type T${i + 1} = T${i}[];`)}\nconst x = null as unknown as T${n};\nconsole.log(x);`,
  ],
  "constants": ["js", n => `const c0 = 1;\n${rows(n, i => `const c${i + 1} = c${i} + 1;`)}\nconsole.log(c${n});`],
  "callers": [
    "js",
    n =>
      `function f0() { return 0; }\n${rows(n, i => `function f${i + 1}() { return f${i}() + 1; }`)}\nconsole.log(typeof f${n});`,
  ],
};

async function ended(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: bunEnv, stdio: ["ignore", "pipe", "pipe"] });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode, signal: child.signalCode };
}

const saysTooDeep =
  /TS100060: The code in ".*" is nested too deeply to be compiled|TS100301: This code is nested more than \d+ levels deep/;
const checkSaysTooDeep = /is nested too deeply: errors in this file may be missing|ran out of stack in /;

// Where the parser gave up: the file, the line and the column.
const saysWhere = /^\s+at .*deep\.(js|ts):\d+:\d+$/m;
// A chain is parsed in a loop, so a later walk of its tree is the first to give up, and that names the file alone.
const isParsedInALoop = new Set(["members", "optional members", "fluent calls", "casts", "array types"]);

// Every walk must bear this much, on every system and under a sanitizer.
const shallow = 500;
// Far beyond where any shape that nests is refused today: between 3,000 and 54,000 levels on Linux x64.
const deep = 200_000;
// At `deep` the parser is the first to give up. What it still bears is the deepest that the walks behind it meet, and they bear less.
const between = [4_000, 8_000, 16_000, 32_000, 64_000];

test.concurrent.each(Object.entries(shapes))(
  "%s",
  async (name, [extension, program]) => {
    using dir = tempDir("aot-deep-programs", {
      "package.json": `{ "name": "p" }`,
      [`shallow.${extension}`]: program(shallow) + "\n",
      [`deep.${extension}`]: program(deep) + "\n",
    });
    const cwd = String(dir);
    const plain = await ended([bunExe(), `./shallow.${extension}`], cwd);
    expect({ ...plain, stderr: "" }).toEqual({ stdout: expect.any(String), stderr: "", exitCode: 0, signal: null });
    const built = await ended(
      [bunExe(), "build", "--compile", "--aot", `./shallow.${extension}`, "--outfile", "./shallow"],
      cwd,
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode, signal: built.signal }).toEqual({
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
      signal: null,
    });
    expect(await ended([join(cwd, "shallow")], cwd)).toEqual(plain);

    const refused = await ended(
      [bunExe(), "build", "--compile", "--aot", `./deep.${extension}`, "--outfile", "./deep"],
      cwd,
    );
    expect(refused.signal).toBeNull();
    if (refused.exitCode !== 0)
      expect({ exitCode: refused.exitCode, stderr: refused.stderr }).toEqual({
        exitCode: 1,
        stderr: expect.stringMatching(saysTooDeep),
      });
    if (refused.exitCode !== 0 && !isParsedInALoop.has(name)) expect(refused.stderr).toMatch(saysWhere);

    const checked = await ended([bunExe(), "check", `./deep.${extension}`], cwd);
    expect(checked.signal).toBeNull();
    if (checked.exitCode !== 0)
      expect({ exitCode: checked.exitCode, said: checked.stdout + checked.stderr }).toEqual({
        exitCode: 1,
        said: expect.stringMatching(checkSaysTooDeep),
      });
  },
  600_000,
);

// The files belong to the run and no test loads them: what the engine's own parser makes of them is another matter.
// Thirteen shapes once ended the run by one panic, each at a depth of its own: three of them are in every run, one for each of those depths on Linux x64.
const onceEndedARun = new Set(["function types", "blocks", "casts"]);
test("the depths in between, as the files of one test run", async () => {
  const all = Object.entries(shapes);
  const others = all.filter(([name]) => !onceEndedARun.has(name));
  const drawn = partOfGrid("deep shapes as the files of a test run", others, 6, ([name]) => name);
  const files: Record<string, string> = { "package.json": `{ "name": "p" }` };
  const loads: string[] = [];
  [...all.filter(([name]) => onceEndedARun.has(name)), ...drawn].forEach(([, [extension, program]], shape) => {
    for (const n of between) {
      files[`shape-${shape}/deep-${n}.${extension}`] = program(n) + "\n";
      loads.push(`() => import("./shape-${shape}/deep-${n}.${extension}")`);
    }
  });
  files["deep.test.js"] =
    `import { expect, test } from "bun:test";\nconst loads = [\n${loads.join(",\n")},\n];\n` +
    `test("t", () => expect(loads.length).toBe(${loads.length}));\n`;
  using run = tempDir("aot-deep-programs-in-a-test-run", files);
  const ran = await ended([bunExe(), "test", "--aot"], String(run));
  expect({
    passed: /^ *\d+ pass$/m.exec(ran.stderr)?.[0].trim(),
    panic: /panic.*/.exec(ran.stderr)?.[0],
    exitCode: ran.exitCode,
    signal: ran.signal,
  }).toEqual({ passed: "1 pass", panic: undefined, exitCode: 0, signal: null });
}, 600_000);
