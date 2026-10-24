// Whole JavaScript projects as people have them: no tsconfig.json, no bun-types, no @types, some without a package.json. The
// programs under ./programs are compiled as part of a TypeScript project that has `allowJs` and Bun's types (programs/tsconfig.json),
// so none of them shows what the compiler expects of a value where nothing at all declares a type.
//
//   impostors-projects/<name>/            one project: main.js, main.mjs or main.cjs and its modules. Only .js, .mjs, .cjs and .json files
//   impostors-projects/<name>/installed/  becomes node_modules/ in the copy, at any depth: git ignores a folder of that name
//   impostors-projects/<name>.json        { "reference": "compiled" }: compare with `bun build --compile` without --aot, where the
//                                         bundler and `bun run` differ on purpose. It lies beside the project, which stays as it is
//   impostors-projects/<name>.expected.txt  what the executable prints where that is meant to differ from plain Bun
//
// In each project a value is made in one module and used in another, which has seen other values there: an array and then
// something that only looks like one. Each project is copied to a temporary folder with nothing above it, built there with
// `bun build --compile --aot` and run, and must print what `bun run` prints there.
//
//   AOT_PROGRAMS=cycle bun test test/aot/impostors-in-projects-without-types     the projects whose name contains the text
import { expect } from "bun:test";
import { existsSync, readdirSync, readFileSync, renameSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join, relative } from "path";
import { unpacked } from "./generate";
import {
  built,
  expectCompiledOutput,
  slot,
  spawned,
  told,
  unsupported,
  wanted,
  withoutDebugInformation,
} from "./run-programs";
import { describe, test } from "./supported";

const projects = unpacked(join(import.meta.dir, "impostors-projects"));
const names = readdirSync(projects, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();
const carrier = unsupported ? [] : withoutDebugInformation();

function filesUnder(folder: string): string[] {
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => relative(folder, join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

/** What would give the project types, or make it part of a larger project. */
function typesIn(folder: string): string[] {
  const inside = filesUnder(folder).filter(
    path =>
      !/\.([cm]?js|json)$/.test(path) || /(^|\/)([tj]sconfig[^/]*\.json$|@types\/|bun-types\/|typescript\/)/.test(path),
  );
  const above: string[] = [];
  for (let up = dirname(folder); ; up = dirname(up)) {
    for (const name of ["tsconfig.json", "jsconfig.json", "package.json", "node_modules"])
      if (existsSync(join(up, name))) above.push(join(up, name));
    if (up === dirname(up)) return [...inside, ...above];
  }
}

function copyOf(name: string) {
  const copy = tempDir("aot-project-without-types", join(projects, name));
  const installed = readdirSync(String(copy), { recursive: true, withFileTypes: true }).filter(
    entry => entry.isDirectory() && entry.name === "installed",
  );
  // The deepest first: a rename moves what is below it.
  for (const entry of installed.sort((a, b) => b.parentPath.length - a.parentPath.length))
    renameSync(join(entry.parentPath, "installed"), join(entry.parentPath, "node_modules"));
  return copy;
}

describe.concurrent("compile/aot/impostors-in-projects-without-types", () => {
  // A debug or ASAN build of Bun takes one project in four.
  const chosen = names.filter((name, index) => (wanted === "quick" ? index % 4 === 0 : name.includes(wanted)));
  if (chosen.length === 0) test.skip("no project selected", () => {});
  for (const name of chosen) {
    test(
      name,
      () =>
        slot(async () => {
          using copy = copyOf(name);
          using output = tempDir("aot-project-without-types-output", {});
          const cwd = String(copy);
          expect(typesIn(cwd)).toEqual([]);
          const main = "./" + readdirSync(cwd).find(entry => /^main\.[cm]?js$/.test(entry));
          const options: { reference?: "compiled" } = existsSync(join(projects, name + ".json"))
            ? JSON.parse(readFileSync(join(projects, name + ".json"), "utf8"))
            : {};

          const program = {
            cwd,
            entryPoints: [main],
            carrier,
            buildFlags: [],
            runEnvironments: [{}],
            outputFolder: String(output),
          };
          const stored = join(projects, name + ".expected.txt");
          if (existsSync(stored))
            return await expectCompiledOutput("compiled", program, {
              stdout: readFileSync(stored, "utf8"),
              stderr: "",
              exitCode: 0,
            });

          let reference = [bunExe(), "run", main];
          if (options.reference === "compiled") {
            reference = [join(String(output), "reference" + (isWindows ? ".exe" : ""))];
            built(
              await spawned([bunExe(), "build", "--compile", ...carrier, main, "--outfile", reference[0]], cwd, bunEnv),
            );
          }
          const plain = await spawned(reference, cwd, bunEnv);
          // A reference run that fails is useless: two runs that end with the same error would compare equal and prove nothing.
          expect({
            signal: plain.signal,
            exitCode: plain.exitCode,
            stderr: plain.exitCode ? plain.stderr : "",
          }).toEqual({ signal: null, exitCode: 0, stderr: "" });
          await expectCompiledOutput("compiled", program, told(plain));
        }),
      600_000,
    );
  }
});
