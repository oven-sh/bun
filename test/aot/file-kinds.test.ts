// The cells of ./generated/file-kinds.ts. A text that plain Bun takes must be taken for the same kind of file by the executable of
// `bun build --compile --aot`: it answers as `bun run` does or, where the executable of `bun build --compile` departs from `bun run`, as that one.
//
//   bun test test/aot/file-kinds                      imported and required: all cells. As the main file: each single mark in a .js file
//   AOT_GENERATED=all bun test test/aot/file-kinds    as the main file: all cells
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { asLibraries, asMain, settings, texts } from "./generated/file-kinds";
import { slot, spawned, unsupported, wanted } from "./run-programs";

// By `<role>: <setting>`, the cells in which --aot answers as neither of the two. A fix takes its cells out of this list.
// On purpose: an imported .cjs file in whose text nothing shows that it is CommonJS is sloppy, as in Node.js (docs/bundler/aot-compatibility.mdx, "Sloppy-mode code").
const alone: Record<string, string[]> = { "imported: cjs": ["none", "L", "C", "LC"] };

const root = String(tempDir("aot-kinds-of-files", {}));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function written(folder: string, { file, text, files }: { file: string; text: string; files: Record<string, string> }) {
  for (const [name, content] of Object.entries({ ...files, [file]: text })) {
    mkdirSync(dirname(join(folder, name)), { recursive: true });
    writeFileSync(join(folder, name), content);
  }
  return file;
}

async function compiled(folder: string, file: string, flags: string[]) {
  const executable = join(folder, isWindows ? "program.exe" : "program");
  try {
    const build = await spawned(
      [bunExe(), "build", "--compile", ...flags, file, "--outfile", executable],
      folder,
      bunEnv,
    );
    if (build.exitCode) return { stdout: "", exitCode: build.exitCode, signal: build.signal, stderr: build.stderr };
    return await spawned([executable], folder, bunEnv);
  } finally {
    rmSync(executable, { force: true });
  }
}

describe.concurrent("compile/aot/kinds of files", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const [index, setting] of Object.keys(settings).entries()) {
    if (wanted === "quick" && index) continue;
    for (const role of ["imported", "required"] as const) {
      test(
        `${role}: ${setting}`,
        () =>
          slot(async () => {
            const folder = join(root, role, setting);
            // What plain Bun refuses would stop the build of the whole program.
            const all = await spawned(
              [bunExe(), "run", written(folder, asLibraries(setting, role, texts))],
              folder,
              bunEnv,
            );
            const taken = all.stdout
              .split("\n")
              .flatMap(line => (line && !line.includes(" FAILS ") ? [line.split(" ")[0]] : []));
            expect(taken.length).toBeGreaterThan(50);
            const file = written(folder, asLibraries(setting, role, taken));
            const plain = await spawned([bunExe(), "run", file], folder, bunEnv);
            expect({ signal: plain.signal, exitCode: plain.exitCode, lines: plain.stdout.split("\n").length }).toEqual({
              signal: null,
              exitCode: 0,
              lines: taken.length + 1,
            });
            const bundle = await compiled(folder, file, []);
            const aot = await compiled(folder, file, ["--aot"]);
            const [ours, theirs, bundled] = [aot, plain, bundle].map(run => run.stdout.split("\n"));
            const known = alone[`${role}: ${setting}`] ?? [];
            const found = theirs.flatMap((line, i) =>
              ours[i] === line || ours[i] === bundled[i]
                ? []
                : [known.includes(taken[i]) ? taken[i] : `--aot: ${ours[i]}\nplain: ${line}\n--compile: ${bundled[i]}`],
            );
            expect({
              alone: found,
              signal: aot.signal,
              exitCode: aot.exitCode,
              stderr: aot.exitCode ? aot.stderr : "",
            }).toEqual({ alone: known, signal: null, exitCode: 0, stderr: "" });
          }),
        600_000,
      );
    }
    for (const text of texts) {
      if (process.env.AOT_GENERATED !== "all" && (setting !== "js" || text.length === 2)) continue;
      test(
        `the main file: ${setting}: ${text}`,
        () =>
          slot(async () => {
            const folder = join(root, "main", setting, text);
            const file = written(folder, asMain(setting, text));
            const plain = await spawned([bunExe(), "run", file], folder, bunEnv);
            const aot = await compiled(folder, file, ["--aot"]);
            // What `bun run` refuses, the executable may refuse too: `exports.e = 1; await null;`. Or it takes it as `bun build --compile` does:
            // `import "node:os"; typeof module` is an ES module to the language and to Node.
            if (plain.exitCode ? aot.exitCode : aot.stdout === plain.stdout && aot.exitCode === 0) return;
            const bundle = await compiled(folder, file, []);
            expect({ stdout: aot.stdout, exitCode: aot.exitCode, signal: aot.signal }).toEqual({
              stdout: bundle.stdout,
              exitCode: bundle.exitCode,
              signal: bundle.signal,
            });
          }),
        600_000,
      );
    }
  }
});
