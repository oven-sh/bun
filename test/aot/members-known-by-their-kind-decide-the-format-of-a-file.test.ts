// A file without `import` and `export` is CommonJS where a name of CommonJS is left behind what `bun run` folds and removes.
// The parser of `bun run` puts the only member of a literal in place of a read of it. Where that member is a function, a
// class or a pattern, it knows by the kind of the member that the read is truthy and not null. Each row is a file of its
// own, and one program requires them all: `require` answers with the namespace of an ES module.
// src/aot/load/format_grid.rs holds the model of the build to the parser for more rows. This file holds an executable to
// plain Bun.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const rows: ["esm" | "cjs", string][] = [
  ["esm", "if ({ b: function named() {} }.b) {} else module.exports = 1;"],
  ["esm", "if ({ b: class Named {} }.b) {} else module.exports = 1;"],
  ["esm", "var v = { a: function named() {} }.a ?? module.exports;"],
  ["esm", "if ({ b: /x/ }.b) {} else module.exports = 1;"],
  ["esm", "if ([() => {}][0]) {} else module.exports = 1;"],
  ["esm", "if ([function () {}][0]) {} else module.exports = 1;"],
  ["esm", "if ([class {}][0]) {} else module.exports = 1;"],
  ["esm", "if ([class A { static m() {} a = 1; }][0]) {} else module.exports = 1;"],
  ["esm", "function dec() {} if ([class { @dec m() {} }][0]) {} else module.exports = 1;"],
  ["esm", 'if ({ "a-b": function named() {} }["a-b"]) {} else module.exports = 1;'],
  ["esm", "if (![() => {}][0]) module.exports = 1;"],
  ["esm", "[function () {}][0] || (module.exports = 1);"],
  ["esm", "[class {}][0] ? 1 : (module.exports = 1);"],
  ["esm", "var v = [class {}][0] ?? module.exports;"],
  ["esm", "var v = [/x/][0] ?? module.exports;"],
  ["esm", "var v = [[]][0] ?? module.exports;"],
  ["esm", "var v = { a: {} }.a ?? module.exports;"],
  // What `bun run` keeps as it is written, or does not know.
  ["cjs", "if ({ b() {} }.b) {} else module.exports = 1;"],
  ["cjs", "function dec(value) { return value; } if ([@dec class {}][0]) {} else module.exports = 1;"],
  ["cjs", "if ({ b: function named() {}, c: 1 }.b) {} else module.exports = 1;"],
  ["cjs", "if ({ b: function named() {} }.b()) {} else module.exports = 1;"],
  ["cjs", "const f = [() => {}][0]; if (f) {} else module.exports = 1;"],
  ["cjs", "let i = 0; if ([() => {}][i]) {} else module.exports = 1;"],
  ["cjs", "let i = 0; var v = [[]][i] ?? module.exports;"],
  ["cjs", "var v = [[]][0] && module.exports;"],
  ["cjs", "if (([[class {}][0] ? 1 : 2][0] && 1) === 1) {} else module.exports = 1;"],
];

// What the build knows of a read costs nothing that runs: an index that is no literal, and a class that runs a block.
const effects = `let ran = 0;
if ([function () {}][(ran += 1, 0)]) ran += 10;
if (![/x/][(ran += 100, 0)]) ran += 1000;
var kept = [class {}][(ran += 10000, 0)] ?? (ran += 100000);
[() => {}][(ran += 1000000, 0)] || (ran += 10000000);
if ([class { static { ran += 100000000; } }][0]) ran += 1000000000;
console.log("ran", ran);
`;
const ask = `function ask(row, load) {
  let loaded;
  try {
    loaded = load();
  } catch (error) {
    console.log(row, "threw", error.name);
    return;
  }
  console.log(row, Object.prototype.toString.call(loaded) === "[object Module]" ? "esm" : "cjs");
}
`;
const files = {
  "main.cjs":
    ask +
    rows.map((_, row) => `ask(${row}, () => require("./row${row}.js"));\n`).join("") +
    `require("./effects.js");\n`,
  "effects.js": effects,
  ...Object.fromEntries(rows.map(([, source], row) => [`row${row}.js`, source + "\n"])),
};
const expected = {
  stdout: rows.map(([format], row) => `${row} ${format}\n`).join("") + "ran 1101010111\n",
  stderr: "",
  exitCode: 0,
};

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("plain Bun takes each file for what the table says", async () => {
  using dir = tempDir("members-known-by-kind-plain", files);
  expect(await run([bunExe(), "main.cjs"], String(dir))).toEqual(expected);
});

test.concurrent("bun test --aot loads a test file that holds such a read", async () => {
  using dir = tempDir("members-known-by-kind-test-run", {
    "read.test.js": `if ([() => expect][0]) {} else module.exports = 1;\ntest("runs", () => { expect(typeof describe).toBe("function"); });\n`,
  });
  const ran = await run([bunExe(), "test", "--aot", "read.test.js"], String(dir));
  expect(ran.stderr).toContain(" 1 pass");
  expect(ran.exitCode).toBe(0);
});

for (const flags of [[], ["--minify-syntax"]]) {
  const build = ["build", "--compile", "--aot", ...flags].join(" ");
  test.concurrent(`an executable of bun ${build} takes each file for what plain Bun takes it for`, async () => {
    using dir = tempDir("members-known-by-kind-executable", files);
    // One thread: what the table asks does not hang on how the build splits its work.
    const cmd = [bunExe(), "build", "--compile", "--aot", "--aot-threads=1", ...flags, "main.cjs", "--outfile", "out"];
    const built = await run(cmd, String(dir));
    expect(built.stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
    expect(built.exitCode).toBe(0);
    expect(await run([join(String(dir), "out")], String(dir))).toEqual(expected);
  });
}
