import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, tempDir, tempDirWithBunTypes } from "harness";
import { join } from "path";

// `import { name } from "node:fs"` where the built-in module has no such export is a SyntaxError when the module is linked,
// before any code runs. Ahead-of-time compiled programs must fail the same way instead of running on with `undefined`.

const modes = ["run", "run --aot", "build --compile", "build --compile --aot"] as const;

async function spawned(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function inMode(mode: (typeof modes)[number], cwd: string, entry: string) {
  if (mode.startsWith("run")) return spawned([bunExe(), ...mode.split(" "), entry], cwd);
  const built = await spawned([bunExe(), ...mode.split(" "), entry, "--outfile", "program"], cwd);
  expect(built.stderr).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return spawned([join(cwd, "program")], cwd);
}

const missing: [entry: string, text: string, message: string][] = [
  ["crypto.mjs", `import { pseudoRandomBytes } from "node:crypto";\nconsole.log("ran", typeof pseudoRandomBytes);\n`, "Export named 'pseudoRandomBytes' not found in module 'node:crypto'."],
  ["stream.mjs", `import { EventEmitter } from "node:stream";\nconsole.log("ran", typeof EventEmitter);\n`, "Export named 'EventEmitter' not found in module 'node:stream'."],
  ["without-prefix.mjs", `import { readFileSync, noSuchExport } from "fs";\nconsole.log("ran", typeof readFileSync, typeof noSuchExport);\n`, "Export named 'noSuchExport' not found in module 'node:fs'."],
  ["renamed.mjs", `import { noSuchExport as local } from "node:path";\nconsole.log("ran", typeof local);\n`, "Export named 'noSuchExport' not found in module 'node:path'."],
  ["unused.mjs", `import { noSuchExport } from "node:os";\nconsole.log("ran");\n`, "Export named 'noSuchExport' not found in module 'node:os'."],
  ["typescript.ts", `// @ts-nocheck\nimport { noSuchExport } from "node:util";\nconsole.log("ran", typeof noSuchExport);\n`, "Export named 'noSuchExport' not found in module 'node:util'."],
  ["sqlite.mjs", `import { noSuchExport } from "bun:sqlite";\nconsole.log("ran", typeof noSuchExport);\n`, "Export named 'noSuchExport' not found in module 'bun:sqlite'."],
];

const fine: [entry: string, text: string, output: string][] = [
  ["existing.mjs", `import path, { sep, posix as p } from "node:path";\nimport { readFileSync } from "fs";\nconsole.log("ran", typeof path, typeof sep, typeof p, typeof readFileSync);\n`, "ran object string object function\n"],
  ["types-are-dropped.ts", `import { readFileSync, PathLike } from "node:fs";\nconst path: PathLike = "x";\nconsole.log("ran", typeof readFileSync, path);\n`, "ran function x\n"],
  ["namespace.mjs", `import * as fs from "node:fs";\nconsole.log("ran", typeof fs.noSuchExport, "noSuchExport" in fs);\n`, "ran undefined false\n"],
  ["bun.mjs", `import { noSuchExport } from "bun";\nconsole.log("ran", typeof noSuchExport);\n`, "ran undefined\n"],
];

describe.each(modes)("bun %s", mode => {
  test.concurrent.each(missing)("a missing export of a built-in module is a SyntaxError: %s", async (entry, text, message) => {
    using dir = tempDir("missing-builtin-export", { [entry]: text });
    const { stdout, stderr, exitCode } = await inMode(mode, String(dir), entry);
    // The bundler drops an import that nothing uses, so an executable never asks for the name.
    if (mode.startsWith("build") && entry === "unused.mjs") {
      expect({ stdout, exitCode }).toEqual({ stdout: "ran\n", exitCode: 0 });
      return;
    }
    expect(stderr).toContain("SyntaxError: " + message);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });

  test.concurrent.each(fine)("what exists is imported: %s", async (entry, text, output) => {
    using dir = tempDirWithBunTypes("missing-builtin-export", { [entry]: text, "tsconfig.json": `{ "compilerOptions": { "types": ["bun"], "skipLibCheck": true } }` });
    const { stdout, exitCode } = await inMode(mode, String(dir), entry);
    expect(stdout).toBe(output);
    expect(exitCode).toBe(0);
  });
});

// The compiler skips the check at run time for the names in this list, so every name in it has to exist.
test("every name in src/aot/builtin-export-names.txt is exported", async () => {
  const lines = readFileSync(join(import.meta.dir, "../../src/aot/builtin-export-names.txt"), "utf8").trimEnd().split("\n");
  const absent: string[] = [];
  for (const line of lines) {
    const [specifier, ...names] = line.split(" ");
    const namespace = await import(specifier);
    for (const name of names) if (!(name in namespace)) absent.push(specifier + " " + name);
  }
  expect(absent).toEqual([]);
  expect(lines.length).toBeGreaterThan(70);
});
