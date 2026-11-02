import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `"paths": { "*": ["./*"] }` and a `baseUrl` let every bare name mean a file of the project as well as an installed package. The build gave up each computed import
// of a bare name in such a project and said nothing: import(`@/plugins/${name}`) threw in an executable, and in a test run the files ran from their text.
// Now it looks in the folders that the config names, then in the installed packages.
//
// In an executable, where the config makes the name uncertain, the files of the PACKAGE stay on disk, as `bun build --compile` without --aot leaves them.
const configs = {
  "a key that matches every name": {
    options: `{ "paths": { "*": ["./*"], "@/*": ["./*"] } }`,
    plugins: "src/plugins",
    isPackageUncertain: true,
  },
  "a baseUrl": { options: `{ "baseUrl": "." }`, plugins: "src/plugins", isPackageUncertain: true },
  "a key for one folder": {
    options: `{ "paths": { "@/*": ["./src/*"] } }`,
    plugins: "@/plugins",
    isPackageUncertain: false,
  },
  "a key for one folder, behind a baseUrl": {
    options: `{ "baseUrl": "./src", "paths": { "~lib/*": ["plugins/*"] } }`,
    plugins: "~lib",
    isPackageUncertain: true,
  },
};
type Config = (typeof configs)[keyof typeof configs];

const fromDisk = `export default "read from disk when the program ran";\n`;
const filesOf = ({ options, plugins }: Config): Record<string, string> => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": ${options} }`,
  "node_modules/specs/package.json": `{ "name": "specs", "type": "module" }`,
  "node_modules/specs/build/a.js": `export default "compiled spec a";\n`,
  "node_modules/specs/build/deep/b.js": `export default "compiled spec b";\n`,
  "src/plugins/one.ts": `export default "compiled plugin one" as string;\n`,
  "src/plugins/deep/two.ts": `export default "compiled plugin two" as string;\n`,
  "src/registry.ts": `const say = (load: Promise<{ default: string }>) => load.then(it => it.default, error => "THROWS " + error.message);
export const loadSpec = (name: string) => say(import(\`specs/build/\${name}.js\`));
export const loadPlugin = (name: string) => say(import(\`${plugins}/\${name}\`));
`,
  "main.ts": `import { loadPlugin, loadSpec } from "./src/registry";
for (const name of ["a", "deep/b"]) console.log("SPEC " + name + " | " + (await loadSpec(name)));
for (const name of ["one", "one.ts", "deep/two"]) console.log("PLUGIN " + name + " | " + (await loadPlugin(name)));
`,
  "loads-one-of-each.test.ts": `import { expect, test } from "bun:test";
import { loadPlugin, loadSpec } from "./src/registry";
test("the files run as they were compiled", async () => {
  console.log("SPEC a | " + (await loadSpec("a")));
  console.log("PLUGIN one | " + (await loadPlugin("one")));
  expect(1).toBe(1);
});
`,
  "other.test.ts": `import { expect, test } from "bun:test";\ntest("another file", () => { expect(1).toBe(1); });\n`,
});

type Ran = Awaited<ReturnType<typeof run>>;

// One file of a bundle stands where --aot has the importer's own name. What an executable advises about code that isn't in it is left out. A path has `/` on every platform.
const linesIn = (stdout: string, kind?: string) =>
  stdout
    .split(/\r?\n/)
    .filter(line => (kind ? line.startsWith(kind + " ") : line !== ""))
    .map(line =>
      line.replace(/ imported from .*| from '.*|(?<=: it isn't in this executable).*/, "").replaceAll("\\", "/"),
    );

/** The lines that a program printed, all of them or those of one kind, and how it ended. */
const told = (ran: Ran, kind?: string) => ({
  lines: linesIn(ran.stdout, kind),
  stderr: ran.stderr,
  exitCode: ran.exitCode,
});
/** A program that printed these lines, nothing on stderr, and ended well. */
const quietly = (lines: string[]) => ({ lines, stderr: "", exitCode: 0 });

const compiledSpecs = ["SPEC a | compiled spec a", "SPEC deep/b | compiled spec b"];
const compiledPlugins = [
  "PLUGIN one | compiled plugin one",
  "PLUGIN one.ts | compiled plugin one",
  "PLUGIN deep/two | compiled plugin two",
];
const specsFromDisk = ["SPEC a | read from disk when the program ran", "SPEC deep/b | compiled spec b"];
const specsOfNoPackage = [
  "SPEC a | THROWS Cannot find package 'specs'",
  "SPEC deep/b | THROWS Cannot find package 'specs'",
];
// What every executable says of code that isn't in it, unless it's built to load code from disk: docs/compiler/compatibility.mdx.
const specsNotInTheExecutable = (dir: string) =>
  ["a", "deep/b"].map(
    name =>
      `SPEC ${name} | THROWS Cannot load '${join(dir, "node_modules/specs/build", `${name}.js`).replaceAll("\\", "/")}': it isn't in this executable`,
  );

/** What a command reports with a code: the level and the code of each, and its file and line in the project where it names a place. */
const reportsIn = (stderr: string, dir: string) =>
  [...stderr.matchAll(/^(\w+): (TS\d+): .*(?:\n +at (.+):(\d+):\d+$)?/gm)].map(([, level, code, file, line]) =>
    file === undefined
      ? `${level} ${code}`
      : `${level} ${code} ${file.replace(dir, "").replaceAll("\\", "/").replace(/^\//, "")}:${line}`,
  );
// Where the import path isn't a constant, and the executable may not load code from disk.
const bothImportsMayThrow = ["warn TS100064 src/registry.ts:2", "warn TS100064 src/registry.ts:3"];

async function build(dir: string, name: string, flags: string[], reports: string[] = []) {
  const executable = join(dir, "elsewhere", isWindows ? name + ".exe" : name);
  const built = await run([bunExe(), "build", "--compile", ...flags, "--outfile", executable, "main.ts"], dir, bunEnv);
  expect({
    reports: reportsIn(built.stderr, dir),
    stderr: built.exitCode ? built.stderr : "",
    exitCode: built.exitCode,
  }).toEqual({ reports, stderr: "", exitCode: 0 });
  return executable;
}

/** What a test run printed, what it reports and what it says of its tests. The folder, the version of Bun and the times are left out. All of stderr where the run fails. */
const toldOfTests = (ran: Ran, dir: string) => ({
  printed: ran.stdout
    .replaceAll(dir, "")
    .split(/\r?\n/)
    .filter(line => line !== "" && !line.startsWith("bun test ")),
  reports: reportsIn(ran.stderr, dir),
  tests: [...ran.stderr.matchAll(/^\((pass|fail|skip|todo)\) (.*?)(?: \[[\d.]+m?s\])?$/gm)]
    .map(([, result, title]) => `${result}: ${title}`)
    .sort(),
  ran: /^Ran \d+ tests? across \d+ files?/m.exec(ran.stderr)?.[0],
  stderr: ran.exitCode ? ran.stderr : "",
  exitCode: ran.exitCode,
});
const bothFilesPass = {
  reports: [] as string[],
  tests: ["pass: another file", "pass: the files run as they were compiled"],
  ran: "Ran 2 tests across 2 files",
  stderr: "",
  exitCode: 0,
};

/** One test file for each config: all four in one took longer than CI gives a file on the lane with assertions. */
export function casesUnder(name: keyof typeof configs) {
  const config = configs[name];
  /** The lines of the package's files: where the config makes the name uncertain, what becomes of files that stay on disk. */
  const specs = (leftOnDisk: string[]) => (config.isPackageUncertain ? leftOnDisk : compiledSpecs);

  test(`an executable under ${name}`, async () => {
    using folder = tempDir("aot-computed-import-tsconfig-paths", filesOf(config));
    const dir = String(folder);
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    const plain = await run([bunExe(), "main.ts"], dir, bunEnv);
    expect(told(plain)).toEqual(quietly([...compiledSpecs, ...compiledPlugins]));

    const compiled = await build(dir, "compiled", ["--aot"], bothImportsMayThrow);
    const open = await build(dir, "open", ["--aot", "--aot-allow-code-from-disk"]);
    const bundled = await build(dir, "bundled", []);
    writeFileSync(join(dir, "node_modules/specs/build/a.js"), fromDisk);
    renameSync(join(dir, "src"), join(dir, "src-moved-away"));

    // node_modules is in reach of the working directory.
    const [compiledHere, openHere, bundledHere] = await Promise.all(
      [compiled, open, bundled].map(executable => run([executable], dir, bunEnv)),
    );
    // A bundle does not hold the plugins: only what it says of the package is compared.
    expect(told(bundledHere, "SPEC")).toEqual(quietly(specsFromDisk));
    expect(told(compiledHere)).toEqual(quietly([...specs(specsNotInTheExecutable(dir)), ...compiledPlugins]));
    expect(told(openHere)).toEqual(quietly([...specs(specsFromDisk), ...compiledPlugins]));

    // It isn't.
    renameSync(join(dir, "node_modules"), join(dir, "moved-away"));
    const [compiledAway, bundledAway] = await Promise.all(
      [compiled, bundled].map(executable => run([executable], elsewhere, bunEnv)),
    );
    expect(told(bundledAway, "SPEC")).toEqual(quietly(specsOfNoPackage));
    expect(told(compiledAway)).toEqual(quietly([...specs(specsOfNoPackage), ...compiledPlugins]));
  }, 240_000);

  for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"]) {
    // A file that runs from its text trips the wire. A file that the run itself writes anew is read from disk, as in plain Bun, so writing over it tells nothing.
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_crashIfInterpreterIsUsed: "1" };
    /** run() holds a run that is asked for layers to them. One that is asked for none says that it is one program. */
    async function expectCompiledRun(dir: string, expected: ReturnType<typeof toldOfTests>) {
      const ran = await run([bunExe(), "test", "--aot", "--isolate"], dir, env);
      expect(toldOfTests(ran, dir)).toEqual(expected);
      if (words === "TestRunLayers:0")
        expect(/^AOT test run \| (.*)$/m.exec(ran.stderr)?.[1]).toMatch(/^one program\b.* \| test files 2$/);
    }

    test(`a test run under ${name} runs the files compiled (${words})`, async () => {
      using dir = tempDir("aot-computed-import-tsconfig-paths", filesOf(config));
      await expectCompiledRun(String(dir), {
        printed: ["SPEC a | compiled spec a", "PLUGIN one | compiled plugin one"],
        ...bothFilesPass,
      });
    }, 120_000);

    test(`a test run under ${name} without the package says what bun test says (${words})`, async () => {
      const files = Object.entries(filesOf(config)).filter(([path]) => !path.startsWith("node_modules/"));
      using dir = tempDir("aot-computed-import-tsconfig-paths", Object.fromEntries(files));
      const plain = toldOfTests(await run([bunExe(), "test", "--isolate"], String(dir), bunEnv), String(dir));
      expect(plain).toEqual({
        printed: [
          expect.stringMatching(/^SPEC a \| THROWS Cannot find package 'specs' (imported )?from /),
          "PLUGIN one | compiled plugin one",
        ],
        ...bothFilesPass,
      });
      using again = tempDir("aot-computed-import-tsconfig-paths", Object.fromEntries(files));
      // The importer too: the files of a test run keep their paths.
      await expectCompiledRun(String(again), plain);
    }, 120_000);
  }
}
