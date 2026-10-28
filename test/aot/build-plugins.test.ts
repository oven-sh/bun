// Plugins of `Bun.build` with `compile: { aot: true }`. The compiler is handed what the plugins resolve and load, not what is on the disk:
// each program is built with and without `aot`, and both executables print what is written here. The one built with `aot` is run with
// BUN_JSC_crashIfInterpreterIsUsed=1, which crashes it if any of its code is interpreted.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

const build = `import plugin from "./plugin";
const result = await Bun.build({ entrypoints: [process.argv[2]], compile: { outfile: process.argv[3], aot: process.argv[4] === "aot" }, plugins: [plugin], throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", types: [] },
  include: ["*.ts"],
  exclude: ["build.ts", "plugin.ts"],
});

const cases: Record<string, { files: Record<string, string>; prints: string }> = {
  "onLoad changes the text of a file": {
    files: {
      "main.ts": `import { answer } from "./lib"; console.log(answer);`,
      "lib.ts": `export const answer: string = "from the disk";`,
      "plugin.ts": `export default { name: "p", setup(b: any) { b.onLoad({ filter: /lib\\.ts$/ }, () => ({ contents: 'export const answer: string = "from the plugin";', loader: "ts" })); } };`,
    },
    prints: "from the plugin\n",
  },
  "onResolve sends an import to another file": {
    files: {
      "main.ts": `import { answer } from "./lib"; console.log(answer);`,
      "lib.ts": `export const answer = "lib";`,
      "other.ts": `export const answer = "other";`,
      "plugin.ts": `import { join } from "path"; export default { name: "p", setup(b: any) { b.onResolve({ filter: /^\\.\\/lib$/ }, () => ({ path: join(import.meta.dir, "other.ts") })); } };`,
    },
    prints: "other\n",
  },
  "a module that is in no file": {
    files: {
      "main.ts": `// @ts-ignore\nimport { answer, twice } from "virtual:config"; console.log(answer, twice(4));`,
      "plugin.ts": `export default { name: "p", setup(b: any) { b.onResolve({ filter: /^virtual:/ }, (a: any) => ({ path: a.path, namespace: "v" })); b.onLoad({ filter: /.*/, namespace: "v" }, () => ({ contents: "export const answer = 42; export function twice(n) { return n * 2; }", loader: "js" })); } };`,
    },
    prints: "42 8\n",
  },
  "onLoad yields JSON, text and an object": {
    files: {
      "main.ts": `// @ts-ignore\nimport j from "./a.data"; import t from "./b.words"; import * as o from "./c.thing"; console.log(JSON.stringify(j), t, o.a, o.default.a);`,
      "a.data": "x",
      "b.words": "y",
      "c.thing": "z",
      "plugin.ts": `export default { name: "p", setup(b: any) { b.onLoad({ filter: /\\.data$/ }, () => ({ contents: '{"n":1}', loader: "json" })); b.onLoad({ filter: /\\.words$/ }, () => ({ contents: "words", loader: "text" })); b.onLoad({ filter: /\\.thing$/ }, () => ({ exports: { a: 1, default: "d" }, loader: "object" })); } };`,
    },
    prints: '{"n":1} words 1 1\n',
  },
  "an extension of its own becomes TypeScript": {
    files: {
      "main.ts": `// @ts-ignore\nimport { greet } from "./hello.tmpl"; console.log(greet("you"));`,
      "hello.tmpl": "hello, NAME\n",
      "plugin.ts": `export default { name: "p", setup(b: any) { b.onLoad({ filter: /\\.tmpl$/ }, async (a: any) => ({ contents: "export function greet(name: string): string { return " + JSON.stringify((await Bun.file(a.path).text()).trim()) + ".replace('NAME', name); }", loader: "ts" })); } };`,
    },
    prints: "hello, you\n",
  },
  "onLoad changes CommonJS that is required": {
    files: {
      "main.cjs": `console.log(require("./lib.cjs").answer);`,
      "lib.cjs": `exports.answer = "from the disk";`,
      "plugin.ts": `export default { name: "p", setup(b: any) { b.onLoad({ filter: /lib\\.cjs$/ }, () => ({ contents: 'exports.answer = "from the plugin";', loader: "js" })); } };`,
    },
    prints: "from the plugin\n",
  },
  "the types are those of the text that the plugin yields": {
    files: {
      "main.ts": `import { value } from "./lib"; const n: number = value; console.log(typeof n, n);`,
      "lib.ts": `export const value: number = 1;`,
      "plugin.ts": `export default { name: "p", setup(b: any) { b.onLoad({ filter: /lib\\.ts$/ }, () => ({ contents: 'export const value: any = "a string";', loader: "ts" })); } };`,
    },
    prints: "string a string\n",
  },
};

describe.concurrent("compile/aot/plugins of Bun.build", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const [name, { files, prints }] of Object.entries(cases)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-build-plugins", { "tsconfig.json": tsconfig, ...files, "build.ts": build });
          const folder = String(dir);
          const main = Object.keys(files).find(file => file.startsWith("main."))!;
          for (const how of ["bundle", "aot"]) {
            const executable = join(folder, how + (isWindows ? ".exe" : ""));
            const built = await spawned([bunExe(), "build.ts", "./" + main, executable, how], folder, bunEnv);
            expect({ how, stdout: built.stdout, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
              how,
              stdout: expect.any(String),
              stderr: expect.any(String),
              exitCode: 0,
            });
            const ran = await spawned(
              [executable],
              folder,
              how === "aot" ? { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" } : bunEnv,
            );
            expect({ how, stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
              how,
              stdout: prints,
              exitCode: 0,
              signal: null,
            });
          }
        }),
      600_000,
    );
  }
});
