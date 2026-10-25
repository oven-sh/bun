import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./run-programs";

const build = (naming: string) => `import plugin, { calls } from "./plugin";
const result = await Bun.build({ entrypoints: ["./main.ts"], compile: { outfile: process.argv[2], aot: true }, ${naming} plugins: [plugin], throw: false });
for (const log of result.logs) console.log(String(log));
console.log("CALLS " + JSON.stringify(Object.fromEntries(Object.entries(calls).sort())));
process.exit(result.success ? 0 : 1);
`;
const byName = `naming: { asset: "[name].[ext]" },`;

const helpers = `import { basename } from "path";
export const calls: Record<string, number> = {};
export async function answer<T>(args: { path: string }, value: T): Promise<T> {
  calls[basename(args.path)] = (calls[basename(args.path)] ?? 0) + 1;
  const delay = Number(process.env.PLUGIN_DELAY_MS ?? 0);
  if (delay) await Bun.sleep(delay);
  return value;
}
`;

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", types: [] },
  include: ["*.ts"],
});

const plugin = (setup: string) => `import { answer, calls } from "./helpers";
export { calls };
export default { name: "assets", setup(b: any) {
${setup}
} };
`;

async function buildIn(folder: string, delay: string) {
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  const built = await spawned([bunExe(), "build.ts", executable], folder, { ...bunEnv, PLUGIN_DELAY_MS: delay });
  const hash = built.exitCode === 0 ? Bun.hash(await Bun.file(executable).bytes()).toString(16) : "";
  const calls = /^CALLS (.*)$/m.exec(built.stdout)?.[1];
  return { executable, built, hash, calls: calls ? JSON.parse(calls) : undefined };
}

type Case = { naming?: string; files: Record<string, string>; prints: string; calls: Record<string, number> };

async function expectSameExecutable({ naming = byName, files, prints, calls }: Case) {
  using dir = tempDir("aot-plugin-assets", {
    "build.ts": build(naming),
    "helpers.ts": helpers,
    "tsconfig.json": tsconfig,
    ...files,
  });
  const folder = String(dir);
  const hashes: string[] = [];
  for (const delay of ["0", "40", "700"]) {
    const { executable, built, hash, calls: made } = await buildIn(folder, delay);
    expect({ delay, stdout: built.stdout, stderr: built.stderr, exitCode: built.exitCode, calls: made }).toEqual({
      delay,
      stdout: expect.any(String),
      stderr: expect.any(String),
      exitCode: 0,
      calls,
    });
    const ran = await spawned([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ delay, stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
      delay,
      stdout: prints,
      stderr: expect.any(String),
      exitCode: 0,
      signal: null,
    });
    hashes.push(hash);
  }
  expect(hashes).toEqual(hashes.map(() => hashes[0]));
}

const reads = `import { readFileSync } from "fs";
const text = (path: string): string => readFileSync(path, "utf8");
`;

const cases: Record<string, Case> = {
  "asset contents come from the plugin": {
    files: {
      "main.ts": `${reads}// @ts-ignore
import big from "./big.bin" with { type: "file" };
import { one } from "./one";
console.log(one, big.endsWith("big.bin"), text(big));`,
      "one.ts": `export const one: number = 1;`,
      "big.bin": "on disk",
      "plugin.ts": plugin(
        `  b.onLoad({ filter: /big\\.bin$/ }, async (a: any) => answer(a, { contents: (await Bun.file(a.path).text()).toUpperCase(), loader: "file" }));`,
      ),
    },
    prints: "1 true ON DISK\n",
    calls: { "big.bin": 1 },
  },
  "a script imported as a file is embedded, not compiled": {
    files: {
      "main.ts": `${reads}// @ts-ignore
import script from "./script.min.js" with { type: "file" };
console.log(text(script));`,
      "script.min.js": "throw 1",
      "plugin.ts": plugin(
        `  b.onLoad({ filter: /script\\.min\\.js$/ }, async (a: any) => answer(a, { contents: "[" + (await Bun.file(a.path).text()) + "]", loader: "file" }));`,
      ),
    },
    prints: "[throw 1]\n",
    calls: { "script.min.js": 1 },
  },
  "scripts that the plugin answers are asked for once, beside a Worker with an unknown path": {
    files: {
      "main.ts": `${reads}// @ts-ignore
import once from "./once.min.js" with { type: "file" };
// @ts-ignore
import twice from "./twice.min.js" with { type: "file" };
import { twiceAgain } from "./again";
console.log(text(once), text(twice), twice === twiceAgain);
const settings: any = ((globalThis as any)[Symbol.for("settings")] ??= {});
if (settings.findWorker) new Worker(settings.findWorker());`,
      "again.ts": `// @ts-ignore
import twiceAgain from "./twice.min.js" with { type: "file" };
export { twiceAgain };`,
      "once.min.js": "!function(){}();",
      "twice.min.js": "!function(){}();",
      "plugin.ts": plugin(
        `  const callsOf = (a: any) => calls[a.path.split(/[\\\\/]/).pop()] ?? 0;
  b.onLoad({ filter: /\\.min\\.js$/ }, (a: any) => answer(a, { contents: "[answer " + (callsOf(a) + 1) + "]", loader: "file" }));`,
      ),
    },
    prints: "[answer 1] [answer 1] true\n",
    calls: { "once.min.js": 1, "twice.min.js": 1 },
  },
  "a plugin that returns undefined embeds the file from disk": {
    files: {
      "main.ts": `${reads}// @ts-ignore
import plain from "./plain.bin" with { type: "file" };
console.log(text(plain));`,
      "plain.bin": "as it lies",
      "plugin.ts": plugin(`  b.onLoad({ filter: /plain\\.bin$/ }, (a: any) => answer(a, undefined));`),
    },
    prints: "as it lies\n",
    calls: { "plain.bin": 1 },
  },
  "a plugin that returns empty contents": {
    files: {
      "main.ts": `${reads}// @ts-ignore
import nothing from "./nothing.bin" with { type: "file" };
console.log(JSON.stringify(text(nothing)));`,
      "nothing.bin": "something",
      "plugin.ts": plugin(
        `  b.onLoad({ filter: /nothing\\.bin$/ }, (a: any) => answer(a, { contents: "", loader: "file" }));`,
      ),
    },
    prints: `""\n`,
    calls: { "nothing.bin": 1 },
  },
  "many assets, and a plugin module that imports a virtual asset": {
    files: {
      "main.ts": `${reads}${Array.from({ length: 90 }, (_, index) => `// @ts-ignore\nimport asset${index} from "./asset${index}.bin" with { type: "file" };`).join("\n")}
// @ts-ignore
import wrapped from "./wrapped.tmpl";
console.log([${Array.from({ length: 90 }, (_, index) => `asset${index}`).join(", ")}].map(text).join(""), wrapped);`,
      ...Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`asset${index}.bin`, String(index % 10)])),
      "wrapped.tmpl": "",
      "decode.ts": `${reads}export function decode(path: string): string { return "<" + text(path) + ">"; }`,
      "plugin.ts":
        plugin(`  b.onLoad({ filter: /asset\\d+\\.bin$/ }, async (a: any) => answer(a, { contents: String(9 - Number(await Bun.file(a.path).text())), loader: "file" }));
  b.onLoad({ filter: /wrapped\\.tmpl$/ }, (a: any) => answer(a, { contents: 'import made from "made:inner.bin" with { type: "file" }; import { decode } from "./decode"; export default decode(made);', loader: "ts" }));
  b.onResolve({ filter: /^made:/ }, (a: any) => ({ path: a.path.slice(5), namespace: "made" }));
  b.onLoad({ filter: /.*/, namespace: "made" }, (a: any) => answer(a, { contents: "made up", loader: "file" }));`),
    },
    prints: `${Array.from({ length: 90 }, (_, index) => String(9 - (index % 10))).join("")} <made up>\n`,
    calls: {
      ...Object.fromEntries(Array.from({ length: 90 }, (_, index) => [`asset${index}.bin`, 1])),
      "wrapped.tmpl": 1,
      "inner.bin": 1,
    },
  },
  "a plugin that returns code for a file import: each callback runs once": {
    files: {
      "main.ts": `// @ts-ignore
import late from "./late.bin" with { type: "file" };
// @ts-ignore
import note from "./note.tmpl";
${reads}// @ts-ignore
import real from "./real.bin" with { type: "file" };
console.log(late, note, text(real));`,
      "late.bin": "",
      "real.bin": "real",
      "note.tmpl": "",
      "other.ts": `export const other: string = "other";`,
      "plugin.ts":
        plugin(`  b.onLoad({ filter: /late\\.bin$/ }, (a: any) => answer(a, { contents: 'import { other } from "./other"; const made: string = "code and " + other; export default made;', loader: "ts" }));
  b.onLoad({ filter: /real\\.bin$/ }, async (a: any) => answer(a, { contents: (await Bun.file(a.path).text()) + "!", loader: "file" }));
  b.onLoad({ filter: /note\\.tmpl$/ }, (a: any) => answer(a, { contents: 'export default "note";', loader: "js" }));
  b.onLoad({ filter: /other\\.ts$/ }, (a: any) => answer(a, undefined));`),
    },
    prints: "code and other note real!\n",
    calls: { "late.bin": 1, "real.bin": 1, "note.tmpl": 1, "other.ts": 1 },
  },
  "a plugin that returns the text loader for a file import": {
    files: {
      "main.ts": `// @ts-ignore
import words from "./words.bin" with { type: "file" };
console.log(words);`,
      "words.bin": "the words themselves",
      "plugin.ts": plugin(
        `  b.onLoad({ filter: /words\\.bin$/ }, async (a: any) => answer(a, { contents: await Bun.file(a.path).text(), loader: "text" }));`,
      ),
    },
    prints: "the words themselves\n",
    calls: { "words.bin": 1 },
  },
  "asset names with a content hash": {
    naming: "",
    files: {
      "main.ts": `${reads}// @ts-ignore
import hashed from "./hashed.bin" with { type: "file" };
console.log(/hashed-[0-9a-z]+\\.bin$/.test(hashed), text(hashed));`,
      "hashed.bin": "on disk",
      "plugin.ts": plugin(
        `  b.onLoad({ filter: /hashed\\.bin$/ }, (a: any) => answer(a, { contents: "from the plugin", loader: "file" }));`,
      ),
    },
    prints: "true from the plugin\n",
    calls: { "hashed.bin": 1 },
  },
  "defer() resolves after assets are loaded": {
    files: {
      "main.ts": `${reads}// @ts-ignore
import asset from "./asset.bin" with { type: "file" };
// @ts-ignore
import seen from "./seen.tmpl";
console.log(text(asset), seen);`,
      "asset.bin": "asset",
      "seen.tmpl": "",
      "plugin.ts": plugin(`  let isAssetLoaded = false;
  b.onLoad({ filter: /asset\\.bin$/ }, async (a: any) => { const made = await answer(a, { contents: "made", loader: "file" }); isAssetLoaded = true; return made; });
  b.onLoad({ filter: /seen\\.tmpl$/ }, async (a: any) => { await a.defer(); return answer(a, { contents: "export default " + isAssetLoaded + ";", loader: "js" }); });`),
    },
    prints: "made true\n",
    calls: { "asset.bin": 1, "seen.tmpl": 1 },
  },
  "a macro runs once when a plugin returns code for a file import": {
    files: {
      "main.ts": `import { count } from "./count" with { type: "macro" };
// @ts-ignore
import late from "./late.bin" with { type: "file" };
console.log(count(), late);`,
      "count.ts": `import { appendFileSync, readFileSync } from "fs";
import { join } from "path";
export function count(): number {
  const file = join(import.meta.dir, "count-" + (process.env.PLUGIN_DELAY_MS ?? "0") + ".txt");
  appendFileSync(file, "x");
  return readFileSync(file, "utf8").length;
}`,
      "late.bin": "",
      "plugin.ts": plugin(
        `  b.onLoad({ filter: /late\\.bin$/ }, (a: any) => answer(a, { contents: 'export default "code";', loader: "js" }));`,
      ),
    },
    prints: "1 code\n",
    calls: { "late.bin": 1 },
  },
};

describe.concurrent("compile/aot/assets loaded by plugins", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const [name, one] of Object.entries(cases)) test(name, () => slot(() => expectSameExecutable(one)), 600_000);

  test(
    "a plugin that throws for an asset fails the build",
    () =>
      slot(async () => {
        using dir = tempDir("aot-plugin-assets", {
          "build.ts": build(byName),
          "helpers.ts": helpers,
          "tsconfig.json": tsconfig,
          "main.ts": `// @ts-ignore\nimport broken from "./broken.bin" with { type: "file" };\nconsole.log(broken);`,
          "broken.bin": "",
          "plugin.ts": plugin(
            `  b.onLoad({ filter: /broken\\.bin$/ }, async (a: any) => { await answer(a, 0); throw new Error("the plugin gave up"); });`,
          ),
        });
        for (const delay of ["0", "400"]) {
          const { built } = await buildIn(String(dir), delay);
          expect({ delay, stdout: built.stdout, exitCode: built.exitCode }).toEqual({
            delay,
            stdout: expect.stringContaining("the plugin gave up"),
            exitCode: 1,
          });
        }
      }),
    600_000,
  );

  test(
    "two assets with the same name and different contents fail the build",
    () =>
      slot(async () => {
        using dir = tempDir("aot-plugin-assets", {
          "build.ts": build(byName),
          "helpers.ts": helpers,
          "tsconfig.json": tsconfig,
          "main.ts": `// @ts-ignore\nimport first from "./a/same.bin" with { type: "file" };\n// @ts-ignore\nimport second from "./b/same.bin" with { type: "file" };\nconsole.log(first, second);`,
          "a/same.bin": "same",
          "b/same.bin": "same",
          "plugin.ts": plugin(
            `  b.onLoad({ filter: /same\\.bin$/ }, (a: any) => answer(a, { contents: a.path, loader: "file" }));`,
          ),
        });
        for (const delay of ["0", "400"]) {
          const { built } = await buildIn(String(dir), delay);
          expect({ delay, stdout: built.stdout, exitCode: built.exitCode }).toEqual({
            delay,
            stdout: expect.stringContaining("same.bin"),
            exitCode: 1,
          });
        }
      }),
    600_000,
  );
});
