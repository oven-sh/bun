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

// One file of a bundle stands where --aot has the importer's own name.
const linesIn = (stdout: string, kind: string) =>
  stdout
    .split("\n")
    .filter(line => line.startsWith(kind + " "))
    .map(line => line.replace(/ imported from .*| from '.*/, ""));

const compiledSpecs = ["SPEC a | compiled spec a", "SPEC deep/b | compiled spec b"];
const compiledPlugins = [
  "PLUGIN one | compiled plugin one",
  "PLUGIN one.ts | compiled plugin one",
  "PLUGIN deep/two | compiled plugin two",
];

async function build(dir: string, name: string, flags: string[]) {
  const executable = join(dir, "elsewhere", isWindows ? name + ".exe" : name);
  const built = await run([bunExe(), "build", "--compile", ...flags, "--outfile", executable, "main.ts"], dir, bunEnv);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return executable;
}

/** One test file for each config: all four in one took longer than CI gives a file on the lane with assertions. */
export function casesUnder(name: keyof typeof configs) {
  const config = configs[name];
  test(`an executable under ${name}`, async () => {
    using folder = tempDir("aot-computed-import-tsconfig-paths", filesOf(config));
    const dir = String(folder);
    const elsewhere = join(dir, "elsewhere");
    mkdirSync(elsewhere);
    const plain = await run([bunExe(), "main.ts"], dir, bunEnv);
    expect(linesIn(plain.stdout, "SPEC")).toEqual(compiledSpecs);
    expect(linesIn(plain.stdout, "PLUGIN")).toEqual(compiledPlugins);

    const compiled = await build(dir, "compiled", ["--aot"]);
    const open = await build(dir, "open", ["--aot", "--aot-allow-code-from-disk"]);
    const bundled = await build(dir, "bundled", []);
    writeFileSync(join(dir, "node_modules/specs/build/a.js"), fromDisk);
    renameSync(join(dir, "src"), join(dir, "src-moved-away"));

    // node_modules is in reach of the working directory.
    const [compiledHere, openHere, bundledHere] = await Promise.all(
      [compiled, open, bundled].map(executable => run([executable], dir, bunEnv)),
    );
    expect(linesIn(bundledHere.stdout, "SPEC")).toEqual([
      "SPEC a | read from disk when the program ran",
      "SPEC deep/b | compiled spec b",
    ]);
    expect(linesIn(compiledHere.stdout, "PLUGIN")).toEqual(compiledPlugins);
    expect(linesIn(openHere.stdout, "PLUGIN")).toEqual(compiledPlugins);
    if (config.isPackageUncertain) {
      expect(linesIn(openHere.stdout, "SPEC")).toEqual(linesIn(bundledHere.stdout, "SPEC"));
      // What every executable says of code that isn't in it, unless it's built to load code from disk: docs/compiler/compatibility.mdx.
      for (const line of linesIn(compiledHere.stdout, "SPEC")) expect(line).toContain("it isn't in this executable");
    } else {
      expect(linesIn(compiledHere.stdout, "SPEC")).toEqual(compiledSpecs);
      expect(linesIn(openHere.stdout, "SPEC")).toEqual(compiledSpecs);
    }

    // It isn't.
    renameSync(join(dir, "node_modules"), join(dir, "moved-away"));
    const [compiledAway, bundledAway] = await Promise.all(
      [compiled, bundled].map(executable => run([executable], elsewhere, bunEnv)),
    );
    expect(linesIn(bundledAway.stdout, "SPEC")).toEqual([
      "SPEC a | THROWS Cannot find package 'specs'",
      "SPEC deep/b | THROWS Cannot find package 'specs'",
    ]);
    expect(linesIn(compiledAway.stdout, "PLUGIN")).toEqual(compiledPlugins);
    expect(linesIn(compiledAway.stdout, "SPEC")).toEqual(
      config.isPackageUncertain ? linesIn(bundledAway.stdout, "SPEC") : compiledSpecs,
    );
  }, 240_000);

  for (const words of ["TestRunLayers:0", "TestRunLayers:2,TestRunPartFiles:1"]) {
    // A file that runs from its text trips the wire. A file that the run itself writes anew is read from disk, as in plain Bun, so writing over it tells nothing.
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_crashIfInterpreterIsUsed: "1" };
    test(`a test run under ${name} runs the files compiled (${words})`, async () => {
      using dir = tempDir("aot-computed-import-tsconfig-paths", filesOf(config));
      const ran = await run([bunExe(), "test", "--aot", "--isolate"], String(dir), env);
      expect({
        specs: linesIn(ran.stdout, "SPEC"),
        plugins: linesIn(ran.stdout, "PLUGIN"),
        exitCode: ran.exitCode,
      }).toEqual({ specs: ["SPEC a | compiled spec a"], plugins: ["PLUGIN one | compiled plugin one"], exitCode: 0 });
    }, 120_000);

    test(`a test run under ${name} without the package says what bun test says (${words})`, async () => {
      const files = Object.entries(filesOf(config)).filter(([path]) => !path.startsWith("node_modules/"));
      using dir = tempDir("aot-computed-import-tsconfig-paths", Object.fromEntries(files));
      const plain = await run([bunExe(), "test", "--isolate"], String(dir), bunEnv);
      expect(linesIn(plain.stdout, "SPEC")).toEqual(["SPEC a | THROWS Cannot find package 'specs'"]);
      using again = tempDir("aot-computed-import-tsconfig-paths", Object.fromEntries(files));
      const ran = await run([bunExe(), "test", "--aot", "--isolate"], String(again), env);
      expect({
        specs: linesIn(ran.stdout, "SPEC"),
        plugins: linesIn(ran.stdout, "PLUGIN"),
        exitCode: ran.exitCode,
      }).toEqual({ specs: linesIn(plain.stdout, "SPEC"), plugins: ["PLUGIN one | compiled plugin one"], exitCode: 0 });
    }, 120_000);
  }
}
