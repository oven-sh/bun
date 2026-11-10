import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// The build links the imports of a program as if no plugin could answer for them, unless a file that it compiles names Bun.plugin. A program that came by the function some other way got the real
// module, in silence, where `bun main.mjs`, the plain executable and `bun test` get the plugin's. Such a plugin is refused aloud where it registers something: in onResolve(), onLoad() and module().
const refusal = "Cannot use Bun.plugin: no file that was compiled names it";
const env = { ...bunEnv, NO_COLOR: "1" };
const options = String.raw`{ name: "swaps", setup(build) {
  build.onResolve({ filter: /a\.mjs$/ }, args => ({ path: args.path, namespace: "swapped" }));
  build.onLoad({ filter: /.*/, namespace: "swapped" }, args => ({ contents: "export default " + JSON.stringify("the plugin's " + args.path), loader: "js" }));
} }`;
const modules = {
  "a.mjs": `export default "the real a";`,
  "b.mjs": `export default "the real b";`,
  "use.mjs": `export const use = (bun, options) => bun.plugin(options);`,
  "package.json": `{ "name": "program", "type": "module" }`,
};
const loads = `const pick = process.argv.length > 5 ? "./b.mjs" : "./a.mjs";
console.log((await import(pick)).default);`;

async function answersOf(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-plugin-that-no-compiled-file-names", files);
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], String(dir), env);
  const built = await run(
    [bunExe(), ...compileCommand, ...flags, "main.mjs", "--outfile", executable],
    String(dir),
    env,
  );
  expect(built.exitCode).toBe(0);
  return { plain, compiled: await run([executable], String(dir), env) };
}

describe("an executable", () => {
  test.each([
    ["Bun is handed to a helper", `import { use } from "./use.mjs";\nuse(Bun, ${options});`],
    ["by a key that the build cannot read", `Bun[JSON.parse('"plugin"')](${options});`],
    ["off the global object by a key that is made", `globalThis[["B", "un"].join("")].plugin(${options});`],
  ])("%s", async (_, registers) => {
    const { plain, compiled } = await answersOf({ ...modules, "main.mjs": registers + "\n" + loads });
    expect(plain.stdout).toBe("the plugin's ./a.mjs\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    expect(compiled.stderr).toContain(refusal);
  });

  test("a plugin that registers nothing goes through", async () => {
    const registers = `import { use } from "./use.mjs";\nuse(Bun, { name: "idle", setup(build) { console.log(typeof build.onLoad); } });`;
    const { plain, compiled } = await answersOf({ ...modules, "main.mjs": registers + "\n" + loads });
    expect(plain.stdout).toBe("function\nthe real a\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test.each([
    ["named in sight", `Bun.plugin(${options});`],
    ["named by a key that the build folds", `Bun[["plu", "gin"].join("")](${options});`],
    ["read by Reflect.get under its name", `Reflect.get(Bun, "plugin")(${options});`],
  ])("%s, the plugin answers", async (_, registers) => {
    const { plain, compiled } = await answersOf({ ...modules, "main.mjs": registers + "\n" + loads });
    expect(plain.stdout).toBe("the plugin's ./a.mjs\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test("where code may come from disk, a file from disk registers a plugin for what it loads itself", async () => {
    const files = {
      "package.json": modules["package.json"],
      "main.mjs": `await import(process.cwd() + "/" + JSON.parse('"late"') + ".mjs");`,
      "late.mjs": `Bun.plugin({ name: "makes", setup(build) { build.module("made:up", () => ({ exports: { default: "made up" }, loader: "object" })); } });
console.log((await import("made:up")).default);`,
    };
    const { plain, compiled } = await answersOf(files, "--aot-allow-code-from-disk");
    expect(plain.stdout).toBe("made up\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});

// A DECLARED LIMIT. docs/compiler/compatibility.mdx: "With `--aot-allow-code-from-disk` it doesn't throw, because a file from disk may register a plugin for what it loads itself.
// The calls in your compiled files aren't sent to that plugin." `bun main.mjs` and the plain executable send them. The declared answer is written down, so that a change of it is seen.
// The executable runs away from its sources, beside nothing but what is meant to come from disk: beside its sources a file on disk answers where the executable finds none, and hides a fault.
describe("an executable where code may come from disk, away from its sources", () => {
  async function answersAwayFromSources(files: Record<string, string>, fromDisk: string[]) {
    using sources = tempDir("aot-a-plugin-out-of-sight-sources", files);
    using elsewhere = tempDir(
      "aot-a-plugin-out-of-sight-elsewhere",
      Object.fromEntries(fromDisk.map(name => [name, files[name]])),
    );
    const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
    const plain = await run([bunExe(), "main.mjs"], String(sources), env);
    const command = [bunExe(), ...compileCommand, "--aot-allow-code-from-disk", "main.mjs", "--outfile", executable];
    expect((await run(command, String(sources), env)).exitCode).toBe(0);
    return { plain, compiled: await run([executable], String(elsewhere), env) };
  }
  const late = `await import(process.cwd() + "/" + JSON.parse('"late"') + ".mjs");`;
  const made = `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);`;
  const both = {
    ...modules,
    "a.cjs": `module.exports = { default: "the real a" };`,
    "b.cjs": `module.exports = { default: "the real b" };`,
  };
  const forBoth = options.replace(String.raw`/a\.mjs$/`, String.raw`/a\.[mc]js$/`);

  test.each([
    ["Bun is handed to a helper", `import { use } from "./use.mjs";\nuse(Bun, ${options});\n${loads}`, "./a.mjs"],
    ["by a key that the build cannot read", `Bun[JSON.parse('"plugin"')](${options});\n${loads}`, "./a.mjs"],
    [
      "off the global object by a key that is made",
      `globalThis[["B", "un"].join("")].plugin(${options});\n${loads}`,
      "./a.mjs",
    ],
    ["by a file from disk", `${late}\n${loads}`, "./a.mjs"],
    [
      "by a file from disk, for require()",
      `${made}\n${late}\nconst pick = process.argv.length > 5 ? "./b.cjs" : "./a.cjs";\nconsole.log(require(pick).default);`,
      "./a.cjs",
    ],
    [
      "by a file from disk, for a name that is put together",
      `${late}\nconst letter = process.argv.length > 5 ? "b" : "a";\nconsole.log((await import("./" + letter + ".mjs")).default);`,
      "./a.mjs",
    ],
    [
      "by a file from disk, for a written name that a made require() is handed",
      `${made}\n${late}\nconsole.log(require("./a.cjs").default);`,
      "./a.cjs",
    ],
    [
      "by a file from disk, for a written name that import.meta.require() is handed",
      `${late}\nconsole.log(import.meta.require("./a.cjs").default);`,
      "./a.cjs",
    ],
  ])("a plugin that is registered %s is not asked by compiled files", async (_, main, name) => {
    const files = { ...both, "late.mjs": `Bun.plugin(${forBoth});`, "main.mjs": main };
    const { plain, compiled } = await answersAwayFromSources(files, ["late.mjs"]);
    expect(plain.stdout).toBe(`the plugin's ${name}\n`);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "the real a\n", exitCode: 0 });
  });

  // No limit: this must stay right. Whoever sends such calls to the loader has to see that it still finds what the executable holds.
  test("calls that the bundler does not read find the files and the data that the executable holds", async () => {
    const files = {
      ...both,
      "data.json": `{ "name": "made-up", "size": 3, "list": [1, 2] }`,
      "main.mjs": `${made}
const data = require("./data.json");
const pick = process.argv.length > 5 ? "./b.cjs" : "./a.cjs";
console.log(data.name, Object.keys(data).length, import.meta.require("./data.json").size, require("./a.cjs").default, require(pick).default, (await import(pick)).default.default);`,
    };
    const { plain, compiled } = await answersAwayFromSources(files, []);
    expect(plain.stdout).toBe("made-up 3 3 the real a the real a the real a\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});

describe("a test run", () => {
  test.each([
    [
      "Bun is handed to a helper",
      {
        ...modules,
        "a.test.js": `import { test } from "bun:test";
import { use } from "./use.mjs";
test("registers", async () => {
  use(Bun, ${options});
  console.log("SAID", (await import("./a.mjs")).default);
});`,
      },
    ],
    [
      "a file that is loaded from disk registers it",
      {
        ...modules,
        "register.cjs": `Bun.plugin(${options});`,
        "a.test.js": `import { test } from "bun:test";
test("registers", async () => {
  require(JSON.parse('"./register.cjs"'));
  console.log("SAID", (await import("./a.mjs")).default);
});`,
      },
    ],
  ])("%s", async (_, files) => {
    using dir = tempDir("aot-a-plugin-that-no-compiled-file-names", files);
    const plain = await run([bunExe(), "test", "./a.test.js"], String(dir), env);
    expect(plain.stdout).toContain("SAID the plugin's ./a.mjs");
    const compiled = await run([bunExe(), "test", "--aot", "./a.test.js"], String(dir), env);
    expect(compiled.stdout).not.toContain("SAID");
    expect(compiled.stderr).toContain(refusal);
    expect(compiled.exitCode).toBe(1);
  });
});
