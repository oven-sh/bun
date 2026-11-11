// createRequire() gets a path that the functions of `node:path/posix`, `path/posix` or `path.posix` make out of the file's own path. Everywhere but on Windows they are
// the functions of `node:path`, so the build reads the folder that the require looks from, and the files that it names are in the executable. On Windows
// `path.posix.dirname()` answers "." for a native path: there such a program fails under plain Bun, and the executable fails the same way.
// Each case names a file of its own, so none finds what another brought in. The sources are moved away before the executable runs.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const say = (name: string, value: string) =>
  `try { console.log(${JSON.stringify(name)} + ": " + ${value}); } catch (error) { console.log(${JSON.stringify(name)} + ": " + (error.code ?? error.name)); }\n`;

// What a case is called, its code, and the file that it loads: the code names the file by `./` and its last part.
type Way = [name: string, code: (target: string) => string, target: string];

const modules: Way[] = [
  [
    "named",
    target =>
      `import { dirname, join } from "node:path/posix";\n` +
      say("named", `createRequire(join(dirname(import.meta.path), "x.js"))("./${target}")`),
    "t1.cjs",
  ],
  [
    "folder",
    target =>
      `import { join } from "path/posix";\n` +
      say("folder", `createRequire(join(import.meta.dir, "d2", "x.js"))("./${target}")`),
    "d2/t.cjs",
  ],
  [
    "member",
    target =>
      `import path from "node:path";\n` +
      say("member", `createRequire(path.posix.join(import.meta.dir, "x.js"))("./${target}")`),
    "t3.cjs",
  ],
  [
    "resolved",
    target =>
      `import { posix } from "node:path";\nconst { resolve } = posix;\n` +
      say("resolved", `createRequire(resolve(import.meta.dir, "d4") + "/")("./${target}")`),
    "d4/t.cjs",
  ],
  [
    "awaited",
    target =>
      `const { dirname } = await import("node:path/posix");\n` +
      say("awaited", `createRequire(dirname(import.meta.path) + "/")("./${target}")`),
    "t5.cjs",
  ],
  [
    "held",
    target =>
      `import { join } from "node:path/posix";\nconst made = createRequire(join(import.meta.dir, "d6", "x.js"));\n` +
      say("held", `made("./${target}") + ", " + made.call(null, "./u.cjs") + ", " + typeof made.resolve("./v.cjs")`),
    "d6/t.cjs",
  ],
];

const scripts: Way[] = [
  [
    "required",
    target =>
      `const { dirname, join } = require("node:path/posix");\n` +
      say("required", `require("node:module").createRequire(join(dirname(__filename), "x.js"))("./${target}")`),
    "t7.cjs",
  ],
  [
    "taken out",
    target =>
      `const { join } = require("path").posix;\n` +
      say("taken out", `require("node:module").createRequire(join(__dirname, "d8", "x.js"))("./${target}")`),
    "d8/t.cjs",
  ],
  [
    "bound later",
    target =>
      `function load() { return require("node:module").createRequire(d(__filename) + "/")("./${target}"); }\n` +
      `const d = require("node:path").posix.dirname;\n` +
      say("bound later", "load()"),
    "t9.cjs",
  ],
];

const write = ([, code, target]: Way) => code(target.slice(target.lastIndexOf("/") + 1));
const cases = [
  ...modules.map((way, index) => ({
    file: `m${index + 1}.mjs`,
    code: `import { createRequire } from "node:module";\n` + write(way),
    target: way[2],
  })),
  ...scripts.map((way, index) => ({ file: `s${index + 1}.cjs`, code: write(way), target: way[2] })),
];
const loaded = (target: string) => `module.exports = ${JSON.stringify("loaded " + target)};\n`;

const project: Record<string, string> = {
  "src/package.json": `{ "name": "a-require-made-for-a-path" }`,
  // One after the other: plain Bun runs files that are imported together in an order of its own.
  "src/main.mjs": cases.map(it => `await import("./${it.file}");\n`).join(""),
  ...Object.fromEntries(cases.map(it => [`src/${it.file}`, it.code])),
  ...Object.fromEntries(cases.map(it => [`src/${it.target}`, loaded(it.target)])),
  "src/d6/u.cjs": loaded("d6/u.cjs"),
  "src/d6/v.cjs": loaded("d6/v.cjs"),
  "away/empty.txt": "",
};

const lines = (text: string) => text.split(/\r?\n/).filter(Boolean);
// A build that can't read the base of a made require says so: TS100096.
const warnings = (stderr: string) => lines(stderr).filter(line => /^(warn|error)\b/.test(line));

test("a require made for a path that the posix path functions join finds the files of that folder", async () => {
  using dir = tempDir("aot-a-path-that-posix-path-functions-join", project);
  const source = join(String(dir), "src");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), "main.mjs"], source, bunEnv);
  const printed = lines(plain.stdout);
  expect(printed.length).toBe(cases.length);
  if (!isWindows) {
    expect(printed).toEqual([
      "named: loaded t1.cjs",
      "folder: loaded d2/t.cjs",
      "member: loaded t3.cjs",
      "resolved: loaded d4/t.cjs",
      "awaited: loaded t5.cjs",
      "held: loaded d6/t.cjs, loaded d6/u.cjs, string",
      "required: loaded t7.cjs",
      "taken out: loaded d8/t.cjs",
      "bound later: loaded t9.cjs",
    ]);
  }

  // What the build reads doesn't hang on its threads. One thread keeps this build out of a race between the threads of the engine that a debug build of Bun
  // dies of now and then. The stored program requires-made-for-a-path/the-posix-functions-of-path-made-the-path builds on every thread.
  const built = await run(
    [bunExe(), ...compileCommand, withThreads(1), "./main.mjs", "--outfile", executable],
    source,
    bunEnv,
  );
  expect({
    warnings: warnings(built.stderr),
    exitCode: built.exitCode,
    stderr: built.exitCode ? built.stderr : "",
  }).toEqual({ warnings: [], exitCode: 0, stderr: "" });

  renameSync(source, join(String(dir), "moved-away"));
  const compiled = await run([executable], away, bunEnv);
  expect({ stdout: lines(compiled.stdout), exitCode: compiled.exitCode }).toEqual({ stdout: printed, exitCode: 0 });
});

// The build follows such a require to a call that names a constant, where it read the path and the require is not one of two. Anywhere else it says so
// at the maker, however the path functions are spelled: what the call names may not be in the executable. A built-in module needs no folder, so a require
// that loads nothing else gets no warning. What the executable then does hangs on what else the file loads, so it is not run here.
test("the build warns at a require made for a path where it can't follow every call of it", async () => {
  const unread = (functions: string) => `createRequire(${functions}.join(__dirname, process.argv[2], "x.js"))`;
  using dir = tempDir("aot-a-require-made-for-a-path-that-is-not-followed", {
    "package.json": `{ "name": "a-require-made-for-a-path" }`,
    "main.cjs":
      `const { createRequire } = require("node:module");\nconst path = require("node:path");\n` +
      say("path", `${unread("path")}("./t.cjs")`) +
      say("posix", `${unread("path.posix")}("./t.cjs")`) +
      `const held = createRequire(path.join(__dirname, "lib", "x.js"));\n` +
      say("named at the run", `held("./" + process.argv[3])`) +
      `const either = process.argv[4] ? createRequire(path.join(__dirname, "other", "x.js")) : createRequire(path.posix.join(__dirname, "lib", "x.js"));\n` +
      say("one of two", `either("./t.cjs")`) +
      `const builtins = ${unread("path")};\n` +
      say("built-in", `typeof builtins("node:fs").readFileSync + ", " + typeof builtins("fs").readFileSync`),
    "lib/t.cjs": loaded("lib/t.cjs"),
  });
  const plain = await run([bunExe(), "main.cjs", "lib", "t.cjs"], String(dir), bunEnv);
  if (!isWindows) {
    expect(lines(plain.stdout)).toEqual([
      "path: loaded lib/t.cjs",
      "posix: loaded lib/t.cjs",
      "named at the run: loaded lib/t.cjs",
      "one of two: loaded lib/t.cjs",
      "built-in: function, function",
    ]);
  }

  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const built = await run(
    [bunExe(), ...compileCommand, withThreads(1), "./main.cjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  expect({
    warnings: warnings(built.stderr).map(line => line.split(":", 2).join(":")),
    exitCode: built.exitCode,
    stderr: built.exitCode ? built.stderr : "",
  }).toEqual({ warnings: Array(5).fill("warn: TS100096"), exitCode: 0, stderr: "" });
});

// Bun.build() has no switch for one thread, so a debug build of Bun is left out here.
test.skipIf(isDebug)("Bun.build() with compile.aot reads such a base too", async () => {
  using dir = tempDir("aot-a-path-that-posix-path-functions-join-api", {
    "src/main.mjs":
      `import { createRequire } from "node:module";\nimport { join } from "node:path/posix";\n` +
      say("joined", `createRequire(join(import.meta.dir, "lib", "x.js"))("./l.cjs")`),
    "src/lib/l.cjs": loaded("lib/l.cjs"),
    "src/build.mjs": `const built = await Bun.build({ entrypoints: ["./main.mjs"], compile: { outfile: process.argv[2], aot: true } });
console.log(JSON.stringify({ success: built.success, logs: built.logs.map(log => log.level + ": " + log.message) }));
`,
    "away/empty.txt": "",
  });
  const source = join(String(dir), "src");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), "main.mjs"], source, bunEnv);
  expect(plain.stdout).toBe("joined: loaded lib/l.cjs\n");

  const built = await run([bunExe(), "build.mjs", executable], source, bunEnv);
  expect({ stdout: built.stdout.trim(), exitCode: built.exitCode }).toEqual({
    stdout: JSON.stringify({ success: true, logs: [] }),
    exitCode: 0,
  });

  renameSync(source, join(String(dir), "moved-away"));
  const compiled = await run([executable], away, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});
