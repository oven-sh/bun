// "Stored first": compiled code reads a variable of a module of Bun's library with no look at what the variable was born with, where the body of the module stores into it in front of
// every place from which a function that names it could run. Nothing at run time tests that: it is one function of the compiler over one text, which ships with Bun and is the same in every
// program. So it is tested here, once for all programs: every module of the library is run in an executable in which each such read asks whether the variable still is as it was born.
// The modules come from the tables, not from a list in this file: whoever adds a module to the library has it run here, or is told that nothing draws it in.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative, sep } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const env = { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" };
const library = join(import.meta.dir, "..", "..", "src", "js");

/** As the image names them: `node:fs`, `bun:sqlite`, `internal:streams/readable`, `thirdparty:ws`. */
function modulesOfLibrary() {
  const names: string[] = [];
  for (const folder of ["node", "bun", "internal", "thirdparty"]) {
    for (const file of readdirSync(join(library, folder), { recursive: true, withFileTypes: true })) {
      if (!file.isFile() || !/\.(ts|js)$/.test(file.name) || file.name.endsWith(".d.ts")) continue;
      const path = relative(join(library, folder), join(file.parentPath, file.name)).split(sep).join("/");
      // `node/fs.promises.ts` is `node:fs/promises`.
      names.push(`${folder}:${path.replace(/\.(ts|js)$/, "").replaceAll(".", "/")}`);
    }
  }
  return names.sort();
}

// No program that is compiled ahead of time can name them, so no image holds them and nothing is claimed of them.
const heldByNoExecutable = new Set<string>([
  // The command line loads them for itself: `bun ./index.html`, the development server, the start of a process under a flag, the environment of `bun test`.
  "internal:bake",
  "internal:html",
  "internal:serve_cli",
  "internal:process/pre_execution",
  "internal:test/binding",
  "internal:test/environment",
  "internal:test/globals",
  // Their names resolve only under a flag of the command line.
  "node:stream/iter",
  "node:zlib/iter",
  "internal:streams/iter/broadcast",
  "internal:streams/iter/consumers",
  "internal:streams/iter/duplex",
  "internal:streams/iter/push",
  "internal:streams/iter/ringbuffer",
  "internal:streams/iter/share",
  "internal:streams/iter/transform",
]);

test("every module of the library runs with each read of a variable that is stored first asked", async () => {
  const table = modulesOfLibrary();
  // Under the names that a program writes. A package of the library has its own.
  const packages = { "thirdparty:vercel_fetch": "@vercel/fetch" };
  const named = new Set(builtinModules.filter(name => !name.startsWith("bun:internal")));
  for (const name of table) {
    if (heldByNoExecutable.has(name)) continue;
    if (name.startsWith("node:") || name.startsWith("bun:")) named.add(name);
    if (name.startsWith("thirdparty:")) named.add(packages[name] ?? name.slice("thirdparty:".length));
  }
  const program = `import { aotRunEveryLibraryModule } from "bun:internal-for-testing";
function name() {
${[...named].map(name => `  require(${JSON.stringify(name)});`).join("\n")}
}
if (process.argv.length > 9) name();
for (const line of aotRunEveryLibraryModule()) console.log(line);
`;
  using dir = tempDir("aot-every-library-module", { "app.js": program });
  const cwd = String(dir);
  const executable = join(cwd, isWindows ? "app.exe" : "app");
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--aot-testing=CheckProofsAtRunTime",
      "--aot-check=Validate",
      "app.js",
      "--outfile",
      executable,
    ],
    cwd,
    env,
  );
  expect(built.stderr).not.toMatch(/^error\b/m);
  expect(built.exitCode).toBe(0);

  const { stdout, stderr, exitCode } = await run([executable], cwd, env);
  // "AOT: f12 at 34:5: what a variable holds is not of the type that the compiler has proven of it."
  expect(stderr).not.toContain("AOT: f");
  expect(exitCode).toBe(0);
  const ran = stdout.trimEnd().split("\n");
  expect(ran.filter(line => line.includes(" "))).toEqual([]);
  const hasRun = (name: string) =>
    ran.includes(name) || ran.includes(packages[name] ?? name.replace(/^thirdparty:/, ""));
  expect(table.filter(name => !hasRun(name) && !heldByNoExecutable.has(name))).toEqual([]);
  // Whoever gives one of them a name that a program can write takes it off the list.
  expect([...heldByNoExecutable].filter(hasRun)).toEqual([]);
});
