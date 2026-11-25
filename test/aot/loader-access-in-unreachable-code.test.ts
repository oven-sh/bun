import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { sayGoal } from "./harness/goals";
import { run } from "./harness/run";
import { separatePrograms, startsAtAnyEntryPoint } from "./harness/separate-programs";
import { test } from "./supported";

const wire = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

async function built(entry: string, files: Record<string, string>) {
  using dir = tempDir("doors-and-reach", files);
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "--explain=statistics", entry, "--outfile", "program"],
    String(dir),
    { ...bunEnv, NO_COLOR: "1" },
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const ran = await run([join(String(dir), "program")], String(dir), wire);
  return {
    stdout: ran.stdout,
    exitCode: ran.exitCode,
    // Not the size of the file: its sections are whole pages, 64 KB each on arm64 under Linux.
    tableBytes: Number(/^TableBytesEmitted (\d+)$/m.exec(build.stderr)?.[1]),
  };
}

const main = `import { double } from "./lib.mjs";\nconsole.log(double(21));\n`;
const double = `export function double(x) { return x * 2; }\n`;

const notReached: Record<string, string> = {
  "an-export-nobody-imports": `${double}export function evaluate(text) { return (0, eval)(text); }\n`,
  "the-global-object-in-a-function-nobody-calls": `${double}function made(options) { return options; }\nexport function windowOf(options) {\n  const found = options?.window ?? (typeof document !== "undefined" ? window : undefined);\n  return made({ window: found });\n}\n`,
};
const notReachedAndStillDear: Record<string, string> = {
  "a-function-that-only-such-a-function-calls": `${double}function load(name) { return require(name); }\nexport function loadTwice(name) { return [load(name), load(name)]; }\n`,
};

const builtWith = new Map<string, ReturnType<typeof built>>();
function builtOnceWith(lib: string) {
  let once = builtWith.get(lib);
  if (!once) builtWith.set(lib, (once = built("main.mjs", { "main.mjs": main, "lib.mjs": lib })));
  return once;
}

/** What `--explain=trim` says the program uses, and the features that it says stay, each with why. */
async function keptWith(lib: string) {
  using dir = tempDir("doors-and-reach", { "main.mjs": main, "lib.mjs": lib });
  const explain = [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.mjs"];
  const { stderr } = await run(explain, String(dir), { ...bunEnv, NO_COLOR: "1" });
  return [...stderr.matchAll(/^aot: trim: ((?:kept|uses) .+)$/gm)].map(line => line[1]);
}

async function expectNoGrowth(forms: Record<string, string>, atMost: number, goalNotMet?: string) {
  const plain = await builtOnceWith(double);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "42\n", exitCode: 0 });
  for (const [name, lib] of Object.entries(forms)) {
    const found = await builtOnceWith(lib);
    if (goalNotMet) sayGoal(goalNotMet, found.tableBytes - plain.tableBytes, atMost);
    // Where it grows, the failure says by how much, and which features stay for it and not for the plain program.
    const bytes = found.tableBytes - plain.tableBytes;
    const staysAnyway = bytes > atMost ? await keptWith(double) : [];
    const stays = bytes > atMost ? (await keptWith(lib)).filter(feature => !staysAnyway.includes(feature)) : [];
    expect({
      name,
      stdout: found.stdout,
      exitCode: found.exitCode,
      grows: bytes > atMost && { bytes, atMost, stays },
    }).toEqual({ name, stdout: "42\n", exitCode: 0, grows: false });
  }
}

// What is used or stays for the program with the door and not for the plain one. It is asked by name and not by the size of the executable: what stays is cut out of Bun's own code by pages,
// 64 KB each on arm64 under Linux, so the bytes say how many pages the code of a feature touches, which moves with every change to that code. The names are the same on every platform.
// Nothing stays: nothing reaches the function, so it isn't made either.
test("a door in a function that nothing reaches brings no built-in module along", async () => {
  const staysAnyway = await keptWith(double);
  for (const [name, lib] of Object.entries(notReached)) {
    const { stdout, exitCode } = await builtOnceWith(lib);
    const stays = (await keptWith(lib)).filter(line => !staysAnyway.includes(line)).sort();
    expect({ name, stdout, exitCode, stays }).toEqual({
      name,
      stdout: "42\n",
      exitCode: 0,
      stays: [],
    });
  }
}, 240_000);

// A goal that is not met yet: beside a load by a name that nobody reads, reached or not, the tables of the executable list every public module of Bun's own that the standard streams load.
// Once it is met this test fails: put the form back into the list above.
test.failing(
  "a load by name in a function that only a function nobody calls calls brings no built-in module along: 46 KB of tables for at most 32 KB",
  () =>
    expectNoGrowth(
      notReachedAndStillDear,
      32 * 1024,
      "a load by name in a function that only a function nobody calls calls brings no built-in module along",
    ),
  240_000,
);
// A case that is marked fails for whatever reason. That the program is built and answers is asked here, of the same build.
test("a load by name in a function that only a function nobody calls calls: the program is built and answers all the same", async () => {
  for (const [name, lib] of Object.entries(notReachedAndStillDear)) {
    const { stdout, exitCode, tableBytes } = await builtOnceWith(lib);
    expect({ name, stdout, exitCode }).toEqual({ name, stdout: "42\n", exitCode: 0 });
    expect(tableBytes).toBeGreaterThan(0);
  }
}, 240_000);

// A load under a computed name brings nothing along: it finds a built-in module that a constant name keeps in the executable.
const name = `const name = ["node:", "querystring"].join("");\nif (process.argv.length > 99) require("node:querystring");\n`;

const reached: Record<string, string> = {
  "at-the-top-of-the-module": `${name}console.log(typeof require(name).escape);\n`,
  "in-a-function-that-is-called": `${name}function load(wanted) { return require(wanted); }\nconsole.log(typeof load(name).escape);\n`,
  "in-a-method-found-by-a-made-key": `${name}const table = { load(wanted) { return require(wanted); } };\nconsole.log(typeof table[["lo", "ad"].join("")](name).escape);\n`,
  "in-a-getter": `${name}class Loader { get found() { return require(name); } }\nconsole.log(typeof new Loader().found.escape);\n`,
  "in-a-static-block": `${name}class Loader { static found; static { Loader.found = require(name); } }\nconsole.log(typeof Loader.found.escape);\n`,
  "in-the-initializer-of-a-field": `${name}class Loader { found = require(name); }\nconsole.log(typeof new Loader().found.escape);\n`,
  "in-the-initializer-of-a-field-of-a-class-with-a-constructor": `${name}function make() {\n  return class Loader { found = require(name); constructor() { this.made = true; } };\n}\nconsole.log(typeof new (make())().found.escape);\n`,
  "in-the-default-of-a-parameter": `${name}function load(found = require(name)) { return found; }\nconsole.log(typeof load().escape);\n`,
  "in-an-arrow-function-in-an-arrow-function": `${name}console.log(typeof [name].map(one => [one].map(wanted => require(wanted))[0])[0].escape);\n`,
  "in-the-computed-name-of-a-method-of-a-class-nobody-names": `${name}class Unnamed { [(console.log(typeof require(name).escape), "m")]() {} }\n`,
  "in-the-computed-name-of-a-static-method": `${name}class Unnamed { static [(console.log(typeof require(name).escape), "m")]() {} }\n`,
  "in-the-computed-name-of-a-getter": `${name}class Unnamed { get [(console.log(typeof require(name).escape), "m")]() { return 1; } }\n`,
  "in-the-computed-name-of-an-async-generator-method": `${name}class Unnamed { async *[(console.log(typeof require(name).escape), "m")]() {} }\n`,
  "in-the-computed-name-of-a-method-of-a-class-in-a-method": `${name}class Outer { make() { class Unnamed { [(console.log(typeof require(name).escape), "m")]() {} } } }\nnew Outer().make();\n`,
  "in-a-generator": `${name}function* all() { yield require(name); }\nconsole.log(typeof all().next().value.escape);\n`,
  "in-an-async-function": `${name}async function load() { await null; return require(name); }\nload().then(found => console.log(typeof found.escape));\n`,
};

// Each form is a program of its own in one executable.
const programs = separatePrograms(
  "doors-and-reach",
  Object.fromEntries(Object.entries(reached).map(([form, text]) => [`${form}.cjs`, text])),
  Object.keys(reached).map(form => `${form}.cjs`),
);
for (const form of Object.keys(reached)) {
  test.skipIf(!startsAtAnyEntryPoint).concurrent(
    `a load under a computed name ${form.replaceAll("-", " ")} finds a built-in module that another line names`,
    async () => {
      const found = await programs.start(`${form}.cjs`, wire);
      expect({ stdout: found.stdout, exitCode: found.exitCode }).toEqual({ stdout: "function\n", exitCode: 0 });
    },
    120_000,
  );
}
