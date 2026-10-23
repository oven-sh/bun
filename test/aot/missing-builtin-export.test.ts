import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunExe, isWindows, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { parseModuleExports } from "../../src/codegen/builtins/collect-modules";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

// `import { name } from "node:fs"` where the built-in module has no such export is a SyntaxError when the module is linked,
// before any code runs. Ahead-of-time compiled programs must fail the same way instead of running on with `undefined`.

const modes = ["run", "run --aot", "build --compile", "build --compile --aot"] as const;

async function inMode(mode: (typeof modes)[number], cwd: string, entry: string) {
  if (mode.startsWith("run")) return spawned([bunExe(), ...mode.split(" "), entry], cwd);
  const built = await spawned([bunExe(), ...mode.split(" "), entry, "--outfile", "program"], cwd);
  expect(built.stderr).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return spawned([join(cwd, "program")], cwd);
}

// The engine has two wordings: one for a name that a module imports, one for a name that it hands on. An executable of the compiler checks both kinds of names in one step and has the first wording for both.
const handedOn = (mode: (typeof modes)[number], exporter: string) =>
  mode === "build --compile --aot"
    ? `Export named 'noSuchExport' not found in module '${exporter}'.`
    : "export 'noSuchExport' not found in '";

const missing: [entry: string, text: string, message: string | ((mode: (typeof modes)[number]) => string)][] = [
  [
    "crypto.mjs",
    `import { pseudoRandomBytes } from "node:crypto";\nconsole.log("ran", typeof pseudoRandomBytes);\n`,
    "Export named 'pseudoRandomBytes' not found in module 'node:crypto'.",
  ],
  [
    "stream.mjs",
    `import { EventEmitter } from "node:stream";\nconsole.log("ran", typeof EventEmitter);\n`,
    "Export named 'EventEmitter' not found in module 'node:stream'.",
  ],
  [
    "without-prefix.mjs",
    `import { readFileSync, noSuchExport } from "fs";\nconsole.log("ran", typeof readFileSync, typeof noSuchExport);\n`,
    "Export named 'noSuchExport' not found in module 'node:fs'.",
  ],
  [
    "renamed.mjs",
    `import { noSuchExport as local } from "node:path";\nconsole.log("ran", typeof local);\n`,
    "Export named 'noSuchExport' not found in module 'node:path'.",
  ],
  [
    "unused.mjs",
    `import { noSuchExport } from "node:os";\nconsole.log("ran");\n`,
    "Export named 'noSuchExport' not found in module 'node:os'.",
  ],
  [
    "typescript.ts",
    `// @ts-nocheck\nimport { noSuchExport } from "node:util";\nconsole.log("ran", typeof noSuchExport);\n`,
    "Export named 'noSuchExport' not found in module 'node:util'.",
  ],
  [
    "export-from.mjs",
    `export { noSuchExport } from "node:fs";\nconsole.log("ran");\n`,
    mode => handedOn(mode, "node:fs"),
  ],
  [
    "imported-and-exported.mjs",
    `import { noSuchExport } from "node:fs";\nexport { noSuchExport };\nconsole.log("ran");\n`,
    mode => handedOn(mode, "node:fs"),
  ],
  [
    "sqlite.mjs",
    `import { noSuchExport } from "bun:sqlite";\nconsole.log("ran", typeof noSuchExport);\n`,
    "Export named 'noSuchExport' not found in module 'bun:sqlite'.",
  ],
  [
    "constants.mjs",
    `import { noSuchExport } from "node:constants";\nconsole.log("ran", typeof noSuchExport);\n`,
    "Export named 'noSuchExport' not found in module 'node:constants'.",
  ],
  [
    "process.mjs",
    `import { noSuchExport } from "node:process";\nconsole.log("ran", typeof noSuchExport);\n`,
    "Export named 'noSuchExport' not found in module 'node:process'.",
  ],
];

const fine: [entry: string, text: string, output: string][] = [
  [
    "existing.mjs",
    `import path, { sep, posix as p } from "node:path";\nimport { readFileSync } from "fs";\nconsole.log("ran", typeof path, typeof sep, typeof p, typeof readFileSync);\n`,
    "ran object string object function\n",
  ],
  [
    "types-are-dropped.ts",
    `import { readFileSync, PathLike } from "node:fs";\nconst path: PathLike = "x";\nconsole.log("ran", typeof readFileSync, path);\n`,
    "ran function x\n",
  ],
  [
    "namespace.mjs",
    `import * as fs from "node:fs";\nconsole.log("ran", typeof fs.noSuchExport, "noSuchExport" in fs);\n`,
    "ran undefined false\n",
  ],
  ["bun.mjs", `import { noSuchExport } from "bun";\nconsole.log("ran", typeof noSuchExport);\n`, "ran undefined\n"],
  // Only the main thread has it, so module-exports.txt does not list it.
  [
    "process-debug-end.mjs",
    `import { _debugEnd } from "node:process";\nconsole.log("ran", typeof _debugEnd);\n`,
    "ran function\n",
  ],
];

const absentOnWindows: [entry: string, text: string, message: string, output: string][] = [
  [
    "process-getuid.mjs",
    `import { getuid } from "node:process";\nconsole.log("ran", typeof getuid);\n`,
    "Export named 'getuid' not found in module 'node:process'.",
    "ran function\n",
  ],
  [
    "constants-sigusr1.mjs",
    `import { SIGUSR1 } from "node:constants";\nconsole.log("ran", typeof SIGUSR1);\n`,
    "Export named 'SIGUSR1' not found in module 'node:constants'.",
    "ran number\n",
  ],
];
for (const [entry, text, message, output] of absentOnWindows) {
  if (isWindows) missing.push([entry, text, message]);
  else fine.push([entry, text, output]);
}

// libc decides whether node:constants exports these, and module-exports.txt lists none of them. Each exists on one of the three platforms.
const platformConstants = { linux: "O_DIRECT", darwin: "O_SYMLINK", win32: "SIGBREAK" };
if (process.platform in platformConstants) {
  for (const [platform, name] of Object.entries(platformConstants)) {
    const text = `import { ${name} } from "node:constants";\nconsole.log("ran", typeof ${name});\n`;
    if (platform === process.platform) fine.push([`constants-${name}.mjs`, text, "ran number\n"]);
    else missing.push([`constants-${name}.mjs`, text, `Export named '${name}' not found in module 'node:constants'.`]);
  }
}

describe.each(modes)("bun %s", mode => {
  test.concurrent.each(missing)(
    "a missing export of a built-in module is a SyntaxError: %s",
    async (entry, text, message) => {
      using dir = tempDir("missing-builtin-export", { [entry]: text });
      const { stdout, stderr, exitCode } = await inMode(mode, String(dir), entry);
      // The bundler drops an import that nothing uses, so an executable of the bundler never asks for the name.
      if (mode === "build --compile" && entry === "unused.mjs") {
        expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
        return;
      }
      expect(stderr).toContain("SyntaxError: " + (typeof message === "string" ? message : message(mode)));
      expect(stdout).toBe("");
      expect(exitCode).toBe(1);
    },
  );

  test.concurrent.each(fine)("what exists is imported: %s", async (entry, text, output) => {
    using dir = tempDirWithBunTypes("missing-builtin-export", {
      [entry]: text,
      "tsconfig.json": `{ "compilerOptions": { "types": ["bun"], "skipLibCheck": true } }`,
    });
    const { stdout, exitCode } = await inMode(mode, String(dir), entry);
    expect(stdout).toBe(output);
    expect(exitCode).toBe(0);
  });
});

const readLines = (path: string) =>
  readFileSync(join(import.meta.dir, "../../src", path), "utf8")
    .trimEnd()
    .split("\n");
// A name may be followed by "=" and where its value is, which builtins/module-exports.test.ts checks.
const namesOnly = (path: string) =>
  Array.from(
    parseModuleExports(readFileSync(join(import.meta.dir, "../../src", path), "utf8"), path),
    ([specifier, listed]) => [specifier, ...listed.exports.map(({ name }) => name)].join(" "),
  );
const lines = namesOnly("codegen/builtins/data/module-exports.txt");
const absentOnWindowsLines = readLines("codegen/builtins/data/module-exports-absent-on-windows.txt");
const nativeModules = readLines("jsc/modules/NativeModuleList.h").flatMap(
  line => /macro\("([^"]+)"_s, \w+\)/.exec(line)?.[1] ?? [],
);

// A name in this list is a known member: nothing tests for it at run time. So every name in it has to exist.
test("every name in src/codegen/builtins/data/module-exports.txt is exported", async () => {
  const absent: string[] = [];
  for (const line of lines) {
    const [specifier, ...names] = line.split(" ");
    const namespace = await import(specifier);
    for (const name of names) if (!(name in namespace)) absent.push(specifier + " " + name);
  }
  const taken = absentOnWindowsLines.flatMap(line =>
    line
      .split(" ")
      .slice(1)
      .map(name => line.split(" ")[0] + " " + name),
  );
  expect(absent).toEqual(isWindows ? taken : []);
  const all = new Set(
    lines.flatMap(line =>
      line
        .split(" ")
        .slice(1)
        .map(name => line.split(" ")[0] + " " + name),
    ),
  );
  expect(taken.filter(name => !all.has(name))).toEqual([]);
  expect(lines.length).toBeGreaterThan(70);
  // The generator wants both files in strict order.
  expect(lines.map(line => line.split(" ")[0])).toEqual(lines.map(line => line.split(" ")[0]).sort());
  for (const line of lines) expect(line.split(" ").slice(1)).toEqual(line.split(" ").slice(1).sort());
  const specifiers = lines.map(line => line.split(" ")[0]);
  expect(new Set(specifiers).size).toBe(specifiers.length);
  for (const line of lines) expect(new Set(line.split(" ").slice(1)).size).toBe(line.split(" ").length - 1);
  const native = nativeModules.filter(specifier => specifier !== "bun");
  expect(native.length).toBeGreaterThan(8);
  expect(native.filter(specifier => !specifiers.includes(specifier))).toEqual([]);
});

// `bun` exports every property of `Bun`, libc decides the exports of node:constants, and node:process exports the properties that `process` has when it is first linked.
// Compiled code looks up an unlisted name of these three at run time.
const decidedAtRunTime = ["bun", "node:constants", "node:process"];

// An import of a name that the line of any other native module does not list stops the build. So the line has to list every export.
test("src/codegen/builtins/data/module-exports.txt lists every export of a native module", async () => {
  const namesIn = (list: string[], specifier: string) =>
    list
      .find(line => line.startsWith(specifier + " "))
      ?.split(" ")
      .slice(1) ?? [];
  const closed = nativeModules.filter(specifier => !decidedAtRunTime.includes(specifier));
  expect(closed.length).toBeGreaterThan(6);
  const unlisted: string[] = [];
  for (const specifier of closed) {
    const absent = isWindows ? namesIn(absentOnWindowsLines, specifier) : [];
    const listed = namesIn(lines, specifier).filter(name => !absent.includes(name));
    for (const name of Object.keys(await import(specifier)))
      if (!listed.includes(name)) unlisted.push(specifier + " " + name);
  }
  expect(unlisted).toEqual([]);
});
