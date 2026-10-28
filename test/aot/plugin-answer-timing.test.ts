import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

const build = `import plugin from "./plugin";
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: true }, loader: { ".md": "text" }, plugins: [plugin], throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;

const delayed = `let calls = 0;
export async function delayed<T>(answer: T): Promise<T> {
  const call = calls++;
  const delay = Number(process.env.PLUGIN_DELAY_MS ?? 0);
  if (delay) await Bun.sleep(delay + (process.env.PLUGIN_ORDER === "reverse" ? 400 - call * 40 : call * 40));
  return answer;
}
`;

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, types: [] },
  include: ["*.ts"],
});

type Timing = { PLUGIN_DELAY_MS: string; PLUGIN_ORDER?: string; GOMAXPROCS?: string };

async function buildWith(folder: string, timing: Timing) {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  const built = await spawned([bunExe(), "build.ts", executable], folder, { ...bunEnv, ...timing });
  const hash = built.exitCode === 0 ? Bun.hash(await Bun.file(executable).bytes()).toString(16) : "";
  return { executable, built, hash };
}

async function expectSameExecutable(files: Record<string, string>, timings: Timing[], prints: string) {
  using dir = tempDir("aot-plugin-timing", {
    "build.ts": build,
    "delayed.ts": delayed,
    "tsconfig.json": tsconfig,
    ...files,
  });
  const folder = String(dir);
  const hashes: string[] = [];
  for (const timing of timings) {
    const { executable, built, hash } = await buildWith(folder, timing);
    expect({ timing, stdout: built.stdout, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      timing,
      stdout: expect.any(String),
      stderr: expect.any(String),
      exitCode: 0,
    });
    const ran = await spawned([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ timing, stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      timing,
      stdout: prints,
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    hashes.push(hash);
  }
  expect(hashes).toEqual(hashes.map(() => hashes[0]));
}

const modules = Object.fromEntries(
  Array.from({ length: 40 }, (_, index) => [
    `part${index}.ts`,
    `${index + 1 < 40 ? `import { total as next } from "./part${index + 1}";` : "const next = (n: number): number => n;"}
// @ts-ignore
import note from "./note${index % 4}.md";
export function total(n: number): number { return next(n + ${index}) + note.length * 0; }
`,
  ]),
);

const mixedAnswers = {
  ...modules,
  "main.ts": `import { total } from "./part0";
import { decorate } from "./decorate";
import settings from "./settings.json";
// @ts-ignore
import { greet } from "./greet.tmpl";
import "./globals.tmpl";
// @ts-ignore
import short from "./short.md";
const limit: number = settings.limit;
console.log(total(1), decorate("plain"), limit, greet("you"), short.trim(), lateGlobal.toFixed(1));
`,
  "decorate.ts": `export function decorate(text: string): string { return "<" + text.trim() + ">"; }\n`,
  "settings.json": `{ "limit": "on disk" }`,
  "greet.tmpl": "hello, NAME",
  "globals.tmpl": "",
  "short.md": "short\n",
  "note0.md": "zero ".repeat(40),
  "note1.md": "one ".repeat(40),
  "note2.md": "two ".repeat(40),
  "note3.md": "three ".repeat(40),
  "plugin.ts": `import { basename, join } from "path";
import { delayed } from "./delayed";
export default {
  name: "mixed",
  setup(b: any) {
    b.onLoad({ filter: /\\.md$/ }, async (a: any) => {
      const text = await Bun.file(a.path).text();
      if (text.length < 20) return delayed(undefined);
      return delayed({ contents: 'import text from "late:' + basename(a.path, ".md") + '" with { type: "file" }; import { decorate } from ' + JSON.stringify(join(import.meta.dir, "decorate.ts")) + "; export default decorate(text);", loader: "js" });
    });
    b.onResolve({ filter: /^late:/ }, (a: any) => ({ path: a.path.slice(5), namespace: "late" }));
    b.onLoad({ filter: /.*/, namespace: "late" }, async (a: any) => delayed({ contents: await Bun.file(join(import.meta.dir, a.path + ".md")).text(), loader: "file" }));
    b.onLoad({ filter: /settings\\.json$/ }, () => delayed({ contents: '{ "limit": 7 }', loader: "json" }));
    b.onLoad({ filter: /greet\\.tmpl$/ }, async (a: any) => delayed({ contents: "export function greet(name: string): string { return " + JSON.stringify(await Bun.file(a.path).text()) + ".replace('NAME', name); }", loader: "ts" }));
    b.onLoad({ filter: /globals\\.tmpl$/ }, () => delayed({ contents: "declare global { var lateGlobal: number; }\\nglobalThis.lateGlobal = 2.5;\\nexport {};", loader: "ts" }));
  },
};
`,
};

const cases: Record<string, { files: Record<string, string>; prints: string }> = {
  "JSON typed by what the plugin returns": {
    files: {
      "main.ts": `import settings from "./settings.json"; const limit: number = settings.limit; console.log(limit + 1);`,
      "settings.json": `{ "limit": "on disk" }`,
      "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) { b.onLoad({ filter: /settings\\.json$/ }, () => delayed({ contents: '{ "limit": 7 }', loader: "json" })); } };`,
    },
    prints: "8\n",
  },
  "TypeScript in place of a file": {
    files: {
      "main.ts": `import { answer } from "./lib"; const n: number = answer; console.log(n);`,
      "lib.ts": `export const answer: string = "on disk";`,
      "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) { b.onLoad({ filter: /lib\\.ts$/ }, () => delayed({ contents: "export const answer: number = 42;", loader: "ts" })); } };`,
    },
    prints: "42\n",
  },
  "a module that declares a global": {
    files: {
      "main.ts": `import "./globals"; import { read } from "./read"; console.log(read());`,
      "read.ts": `export function read(): string { return lateGlobal.toFixed(2); }`,
      "globals.ts": `export {};`,
      "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) { b.onLoad({ filter: /globals\\.ts$/ }, () => delayed({ contents: "declare global { var lateGlobal: number; }\\nglobalThis.lateGlobal = 1.5;\\nexport {};", loader: "ts" })); } };`,
    },
    prints: "1.50\n",
  },
  "a deeply nested file outside the bundle that may declare a module": {
    files: {
      "main.ts": `import { answer } from "./lib"; const n: number = answer; console.log(n);`,
      "lib.ts": `export const answer: string = "on disk";`,
      "nested.ts": `declare module "nothing" {}\nexport const nested = ${"[".repeat(100_000)}${"]".repeat(100_000)};`,
      "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) { b.onLoad({ filter: /lib\\.ts$/ }, () => delayed({ contents: "export const answer: number = 42;", loader: "ts" })); } };`,
    },
    prints: "42\n",
  },
  "an answer that waits for every other module": {
    files: {
      "main.ts": `import { count } from "./count"; import { one } from "./one"; console.log(count, one);`,
      "one.ts": `export const one: number = 1;`,
      "count.ts": `export const count: number = 0;`,
      "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) { b.onLoad({ filter: /count\\.ts$/ }, async (a: any) => { await a.defer(); return delayed({ contents: "export const count: number = 3;", loader: "ts" }); }); } };`,
    },
    prints: "3 1\n",
  },
  "a file imported for its types that only a plugin module imports for its code": {
    files: {
      "main.ts": `import type { Shape } from "./shape";
// @ts-ignore
import make from "./make.tmpl";
const shape: Shape = make();
console.log(shape.sides + shape.extra);`,
      "shape.ts": `export interface Shape { sides: number }\nexport function create(): Shape { return { sides: 3 }; }`,
      "make.tmpl": "",
      "plugin.ts": `import { join } from "path"; import { delayed } from "./delayed"; export default { name: "p", setup(b: any) {
        b.onLoad({ filter: /make\\.tmpl$/ }, () => delayed({ contents: "import { create } from " + JSON.stringify(join(import.meta.dir, "shape")) + "; export default create;", loader: "ts" }));
        b.onLoad({ filter: /shape\\.ts$/ }, () => delayed({ contents: "export interface Shape { sides: number; extra: number }\\nexport function create(): Shape { return { sides: 3, extra: 4 }; }", loader: "ts" }));
      } };`,
    },
    prints: "7\n",
  },
  "a file imported for its types, unchanged by plugins, that only a plugin module imports for its code": {
    files: {
      "main.ts": `import type { Shape } from "./shape";
// @ts-ignore
import make from "./make.tmpl";
const shape: Shape = make();
console.log(shape.sides, shape.label);`,
      "shape.ts": `import label from "./label.txt";\nexport interface Shape { sides: number; label: string }\nexport function create(): Shape { return { sides: 3, label }; }`,
      "label.txt": "triangle",
      "text.d.ts": `declare module "*.txt" { const text: string; export default text; }`,
      "make.tmpl": "",
      "plugin.ts": `import { join } from "path"; import { delayed } from "./delayed"; export default { name: "p", setup(b: any) {
        b.onLoad({ filter: /make\\.tmpl$/ }, () => delayed({ contents: "import { create } from " + JSON.stringify(join(import.meta.dir, "shape")) + "; export default create;", loader: "ts" }));
      } };`,
    },
    prints: "3 triangle\n",
  },
  "a plugin module that changes what an early import resolves to": {
    files: {
      "main.ts": `// @ts-ignore
import dual from "dual";
// @ts-ignore
import required from "./required.tmpl";
console.log(dual.kind, required);`,
      "required.tmpl": "",
      "node_modules/dual/package.json": `{ "name": "dual", "version": "1.0.0", "main": "./main.js", "module": "./module.js" }`,
      "node_modules/dual/main.js": `module.exports = { kind: "main" };`,
      "node_modules/dual/module.js": `export default { kind: "module" };`,
      "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) { b.onLoad({ filter: /required\\.tmpl$/ }, () => delayed({ contents: 'const dual = require("dual"); export default dual.kind;', loader: "js" })); } };`,
    },
    prints: "main main\n",
  },
  "imports that a plugin resolves late, of an early file and of a plugin module": {
    files: {
      "main.ts": `// @ts-ignore
import first from "./first.tmpl";
// @ts-ignore
import slow from "./slow.tmpl";
// @ts-ignore
import direct from "virtual:direct";
console.log(first, slow, direct);`,
      "first.tmpl": "",
      "slow.tmpl": "",
      "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) {
        b.onLoad({ filter: /first\\.tmpl$/ }, () => ({ contents: 'import inner from "virtual:inner"; export default inner;', loader: "js" }));
        b.onLoad({ filter: /slow\\.tmpl$/ }, () => delayed({ contents: 'export default "slow";', loader: "js" }));
        b.onResolve({ filter: /^virtual:/ }, (a: any) => delayed({ path: a.path.slice(8), namespace: "virtual" }));
        b.onLoad({ filter: /.*/, namespace: "virtual" }, (a: any) => ({ contents: "export default " + JSON.stringify(a.path) + ";", loader: "js" }));
      } };`,
    },
    prints: "inner slow direct\n",
  },
  "loads that wait for each other": {
    files: {
      "main.ts": `${Array.from({ length: 12 }, (_, index) => `// @ts-ignore\nimport part${index} from "./part${index}.tmpl";`).join("\n")}
console.log([${Array.from({ length: 12 }, (_, index) => `part${index}`).join(", ")}].join(" "));`,
      ...Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`part${index}.tmpl`, ""])),
      "plugin.ts": `import { delayed } from "./delayed"; let arrived = 0; const all = Promise.withResolvers<string>(); export default { name: "p", setup(b: any) {
        b.onLoad({ filter: /part\\d+\\.tmpl$/ }, async () => {
          if (++arrived === 12) all.resolve("together");
          const how = await Promise.race([all.promise, Bun.sleep(10_000).then(() => "alone")]);
          return delayed({ contents: "export default " + JSON.stringify(how) + ";", loader: "js" });
        });
      } };`,
    },
    prints: `${Array(12).fill("together").join(" ")}\n`,
  },
};

// Root files of the tsconfig that nothing runs, some read for their types, some run only by what a plugin answers late.
const manyRoots = {
  ...Object.fromEntries(
    Array.from({ length: 240 }, (_, index) => [
      `root${index}.ts`,
      `export interface Shape${index} { side${index}: number; name: string }
export function make${index}(): Shape${index} { return { side${index}: ${index}, name: "root${index}" }; }
export const list${index} = [make${index}()].map(shape => shape.side${index} + shape.name.length);
`,
    ]),
  ),
  "main.ts": `${Array.from({ length: 20 }, (_, index) => `import type { Shape${index * 3} } from "./root${index * 3}";`).join("\n")}
// @ts-ignore
import late from "./late.tmpl";
const shapes: [${Array.from({ length: 20 }, (_, index) => `Shape${index * 3}`).join(", ")}] = [${Array.from({ length: 20 }, (_, index) => `{ side${index * 3}: ${index}, name: "n" }`).join(", ")}];
console.log(shapes.length, shapes[3].side9, late);
`,
  "late.tmpl": "",
  "plugin.ts": `import { join } from "path"; import { delayed } from "./delayed"; export default { name: "p", setup(b: any) {
    b.onLoad({ filter: /late\\.tmpl$/ }, () => delayed({ contents: ${JSON.stringify(Array.from({ length: 20 }, (_, index) => `import { make${index * 7 + 1} } from "@/root${index * 7 + 1}";`).join("\n"))}.replaceAll("@", import.meta.dir.replaceAll("\\\\", "/")) + "\\nexport default " + ${JSON.stringify(Array.from({ length: 20 }, (_, index) => `make${index * 7 + 1}().side${index * 7 + 1}`).join(" + "))} + ";", loader: "ts" }));
  } };`,
};

describe.concurrent("compile/aot/plugins that answer late", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  test(
    "one executable whenever and in whatever order the plugins answer",
    () =>
      slot(() =>
        expectSameExecutable(
          mixedAnswers,
          [
            { PLUGIN_DELAY_MS: "0" },
            { PLUGIN_DELAY_MS: "1000" },
            { PLUGIN_DELAY_MS: "1000", PLUGIN_ORDER: "reverse" },
            { PLUGIN_DELAY_MS: "1000", PLUGIN_ORDER: "reverse", GOMAXPROCS: "2" },
            { PLUGIN_DELAY_MS: "5000", PLUGIN_ORDER: "reverse" },
          ],
          "781 <plain> 7 hello, you short 2.5\n",
        ),
      ),
    600_000,
  );
  test(
    "one executable whether or not root files are parsed while a plugin works",
    () =>
      slot(() =>
        expectSameExecutable(
          manyRoots,
          [
            { PLUGIN_DELAY_MS: "0" },
            { PLUGIN_DELAY_MS: "30" },
            { PLUGIN_DELAY_MS: "300" },
            { PLUGIN_DELAY_MS: "1500" },
            { PLUGIN_DELAY_MS: "300", GOMAXPROCS: "2" },
          ],
          `20 3 ${Array.from({ length: 20 }, (_, index) => index * 7 + 1).reduce((sum, side) => sum + side, 0)}\n`,
        ),
      ),
    600_000,
  );
  for (const [name, { files, prints }] of Object.entries(cases)) {
    test(
      name,
      () => slot(() => expectSameExecutable(files, [{ PLUGIN_DELAY_MS: "0" }, { PLUGIN_DELAY_MS: "400" }], prints)),
      600_000,
    );
  }
  test(
    "a plugin that fails late fails the build",
    () =>
      slot(async () => {
        using dir = tempDir("aot-plugin-timing", {
          "build.ts": build,
          "delayed.ts": delayed,
          "tsconfig.json": tsconfig,
          "main.ts": `import { answer } from "./lib"; import { one } from "./one"; console.log(answer, one);`,
          "one.ts": `export const one: number = 1;`,
          "lib.ts": `export const answer: number = 1;`,
          "plugin.ts": `import { delayed } from "./delayed"; export default { name: "p", setup(b: any) { b.onLoad({ filter: /lib\\.ts$/ }, async () => { await delayed(0); throw new Error("the plugin gave up"); }); } };`,
        });
        for (const PLUGIN_DELAY_MS of ["0", "400"]) {
          const { built } = await buildWith(String(dir), { PLUGIN_DELAY_MS });
          expect({ PLUGIN_DELAY_MS, stdout: built.stdout, exitCode: built.exitCode }).toEqual({
            PLUGIN_DELAY_MS,
            stdout: expect.stringContaining("the plugin gave up"),
            exitCode: 1,
          });
        }
      }),
    600_000,
  );
});
