import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

type Files = Record<string, string>;

const MODES = ["bundle", "aot"];
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const exe = (name: string) => name + (isWindows ? ".exe" : "");

const BUILD = `import plugins from "./plugins";
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: process.argv[3] === "aot" }, plugins, throw: false });
for (const log of result.logs) console.log(String(log));
process.exit(result.success ? 0 : 1);
`;

const TSCONFIG = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
  },
  files: ["main.ts"],
});

const pluginsFile = (...setup: string[]) =>
  `export default [{ name: "p", setup(b: any) {\n${setup.join("\n")}\n} }];\n`;
const onLoad = (filter: RegExp, callback: string) => `b.onLoad({ filter: ${filter} }, ${callback});`;
const returnTypeScript = (contents: string) => `return { contents: ${JSON.stringify(contents)}, loader: "ts" };`;

async function expectInBothModes(files: Files, output: string) {
  using dir = tempDir("aot-deferred-plugin-loads", { "build.ts": BUILD, "tsconfig.json": TSCONFIG, ...files });
  const folder = String(dir);
  for (const mode of MODES) {
    const program = join(folder, exe(mode));
    const built = await spawned([bunExe(), "build.ts", program, mode], folder, bunEnv);
    expect({ mode, ...built }).toEqual({
      mode,
      stdout: expect.any(String),
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    const ran = await spawned([program], folder, mode === "aot" ? COMPILED : bunEnv);
    expect({ mode, ...ran }).toEqual({ mode, stdout: output, stderr: expect.any(String), exitCode: 0, signal: null });
  }
}

async function expectFailureInBothModes(files: Files, message: string) {
  using dir = tempDir("aot-deferred-plugin-loads", { "build.ts": BUILD, "tsconfig.json": TSCONFIG, ...files });
  const folder = String(dir);
  for (const mode of MODES) {
    const program = join(folder, exe(mode));
    const built = await spawned([bunExe(), "build.ts", program, mode], folder, bunEnv);
    expect({ mode, ...built, wrote: existsSync(program) }).toEqual({
      mode,
      stdout: expect.stringContaining(message),
      stderr: expect.any(String),
      exitCode: 1,
      signal: null,
      wrote: false,
    });
  }
}

const partCount = Math.max(64, availableParallelism() * 4);
const partIndices = Array.from({ length: partCount }, (_, index) => index);

const partsProgram: Files = {
  ...Object.fromEntries(partIndices.map(index => [`part${index}.ts`, "export const seen: number = 0;\n"])),
  "main.ts":
    partIndices.map(index => `import { seen as seen${index} } from "./part${index}";\n`).join("") +
    `console.log([${partIndices.map(index => `seen${index}`).join(", ")}].every(seen => seen === ${partCount}));\n`,
};

const countProgram: Files = {
  "main.ts": 'import { count } from "./count";\nconsole.log(count);\n',
  "count.ts": "export const count: number = 0;\n",
};

const successes: [name: string, files: Files, output: string][] = [
  [
    "more deferred loads than threads",
    {
      ...partsProgram,
      "plugins.ts":
        "let asked = 0;\n" +
        pluginsFile(
          onLoad(
            /part\d+\.ts$/,
            'async (a: any) => { asked++; await a.defer(); return { contents: "export const seen: number = " + asked + ";", loader: "ts" }; }',
          ),
        ),
    },
    "true\n",
  ],
  [
    "deferred text imports another deferred file",
    {
      ...countProgram,
      "late.ts": "export const late: number = 0;\n",
      "plugins.ts": pluginsFile(
        onLoad(
          /count\.ts$/,
          `async (a: any) => { await a.defer(); ${returnTypeScript('import { late } from "./late"; export const count: number = late + 1;')} }`,
        ),
        onLoad(
          /late\.ts$/,
          `async (a: any) => { await a.defer(); ${returnTypeScript("export const late: number = 41;")} }`,
        ),
      ),
    },
    "42\n",
  ],
  [
    "deferred virtual module",
    {
      "main.ts": '// @ts-ignore\nimport late from "virtual:late";\nconsole.log(late);\n',
      "plugins.ts": pluginsFile(
        'b.onResolve({ filter: /^virtual:/ }, (a: any) => ({ path: a.path.slice(8), namespace: "v" }));',
        'b.onLoad({ filter: /.*/, namespace: "v" }, async (a: any) => { await a.defer(); return { contents: "export default " + JSON.stringify(a.path) + ";", loader: "js" }; });',
      ),
    },
    "late\n",
  ],
  [
    "answer returned without awaiting .defer()",
    {
      ...countProgram,
      "plugins.ts": pluginsFile(
        onLoad(/count\.ts$/, `(a: any) => { a.defer(); ${returnTypeScript("export const count: number = 3;")} }`),
      ),
    },
    "3\n",
  ],
  [
    "deferred load without an answer reads the file",
    { ...countProgram, "plugins.ts": pluginsFile(onLoad(/count\.ts$/, "async (a: any) => { await a.defer(); }")) },
    "0\n",
  ],
];

const failures: [name: string, callback: string, message: string][] = [
  [
    ".defer() called twice",
    `async (a: any) => { await a.defer(); await a.defer(); ${returnTypeScript("export const count: number = 3;")} }`,
    "Can't call .defer() more than once within an onLoad plugin",
  ],
  [
    "load throws after .defer()",
    'async (a: any) => { await a.defer(); throw new Error("gave up after waiting"); }',
    "gave up after waiting",
  ],
];

const cancelledBuild: Files = {
  "tsconfig.json": TSCONFIG,
  "main.ts": 'import { lib } from "./lib";\nimport { other } from "./other";\nconsole.log(lib, other);\n',
  "lib.ts": "export const lib = 1;\n",
  "other.ts": "export const other = 1;\n",
  "builder.ts": `Bun.build({
  entrypoints: ["./main.ts"],
  compile: { outfile: process.env.OUTFILE!, aot: process.env.MODE === "aot" },
  plugins: [{ name: "p", setup(b) {
    b.onLoad({ filter: ${/lib\.ts$/} }, async a => { postMessage("asked"); if (process.env.WAITS === "in defer") await a.defer(); return { contents: "export const lib = 1;", loader: "ts" }; });
    b.onLoad({ filter: ${/other\.ts$/} }, () => { postMessage("asked"); return new Promise(() => {}); });
  } }],
});
`,
  "cancel.ts": `const worker = new Worker(new URL("./builder.ts", import.meta.url).href);
let asked = 0;
worker.onmessage = async () => {
  if (++asked < 2) return;
  await worker.terminate();
  console.log("terminated");
};
`,
};

describe.concurrent("compile/aot/load/deferred-plugin-loads", () => {
  test.each(successes)("%s", (_, files, output) => slot(() => expectInBothModes(files, output)), 600_000);

  test.each(failures)(
    "%s",
    (_, callback, message) =>
      slot(() =>
        expectFailureInBothModes(
          { ...countProgram, "plugins.ts": pluginsFile(onLoad(/count\.ts$/, callback)) },
          message,
        ),
      ),
    600_000,
  );

  test.each(["for an answer", "in defer"].flatMap(WAITS => MODES.map(MODE => [WAITS, MODE])))(
    "cancelled build waiting %s (%s)",
    (WAITS, MODE) =>
      slot(async () => {
        using dir = tempDir("aot-deferred-plugin-loads", cancelledBuild);
        const folder = String(dir);
        const OUTFILE = join(folder, exe(MODE));
        const cancelled = await spawned([bunExe(), "cancel.ts"], folder, { ...bunEnv, OUTFILE, MODE, WAITS });
        expect({ ...cancelled, wrote: existsSync(OUTFILE) }).toEqual({
          stdout: "terminated\n",
          stderr: expect.any(String),
          exitCode: 0,
          signal: null,
          wrote: false,
        });
      }),
    600_000,
  );
});
