// A program loads files that the build never saw: a plugin, a config file, a tool that its user wrote. Their paths are known only when the program runs.
// An executable built with --aot --aot-allow-code-from-disk loads them as one built without --aot does, and Bun interprets them. Each case runs in two executables, in the same folder:
//
//   bun build --compile                                      says what is right
//   bun build --compile --aot --aot-allow-code-from-disk     prints the same and exits alike
//
// Such a build holds every built-in module, so the cases that are built with the same flags share one: their programs lie in folders of one program, whose entry point imports the one that PROGRAM names.
// A case about the entry point itself has executables of its own. Only the largest group holds the built-in modules: the programs of the others import none. Bun.build() builds it, the command line the others.
//
//   program   the files that are compiled. "main.ts" is the entry point
//   disk      the files that lie beside the executable when it runs, in a folder that the build is not told of. It is the working directory and process.argv[2]
//   prints    what both print
//   flags     more flags for both builds
//   aotFlags  more flags for the build with --aot
//   env       more of the environment in which both run
//   differs   what the build with --aot prints where it is meant to differ from the other, and the case says why
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { built, spawned } from "./harness/commands";
import { beforeAll, describe, test } from "./supported";

type Case = {
  program: Record<string, string>;
  disk: Record<string, string>;
  prints: string;
  flags?: string[];
  aotFlags?: string[];
  env?: Record<string, string>;
  entryPoints?: string[];
  differs?: string;
};

const timeout = 600_000;

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    jsx: "react-jsx",
    typeRoots: [join(import.meta.dir, "../../packages")],
    types: ["bun-types"],
  },
});

// `shown` prints what a load answers or how it fails. The text of an error names paths and differs between the builds, so its class and its code stand for it.
const prelude = String.raw`
const folder: string = process.argv[2]!;
const at = (...parts: string[]): string => [folder, ...parts].join("/");
const url = (path: string): string => Bun.pathToFileURL(path).href;
async function shown(label: string, load: () => unknown): Promise<void> {
  try {
    const loaded: any = await load();
    console.log(label + ":", typeof loaded === "object" && loaded !== null ? JSON.stringify(loaded.default ?? loaded) + (loaded.named === undefined ? "" : " " + loaded.named) : String(loaded));
  } catch (error: any) {
    console.log(label + ":", "threw", error?.name, error?.code ?? "");
  }
}
`;

const kinds: Record<string, string> = {
  "plain.js": `export default { kind: "js" }; export const named = "js";`,
  "module.mjs": `export default { kind: "mjs" }; export const named = "mjs";`,
  "common.cjs": `module.exports = { kind: "cjs", named: "cjs" };`,
  "typed.ts": `interface Kind { kind: string } const value: Kind = { kind: "ts" }; export default value; export const named: string = "ts"; export enum Level { Low = 1 }`,
  "view.tsx": `const h = (tag: string): { kind: string } => ({ kind: tag }); export default h("tsx"); export const named = <T,>(value: T): T => value; `,
  "view.jsx": `export default { kind: "jsx" }; export const named = "jsx";`,
  "data.json": `{ "kind": "json", "named": "json" }`,
};

const everyKind = (load: (path: string) => string, name: (file: string) => string) =>
  Object.keys(kinds)
    .map(file => `await shown(${JSON.stringify(file)}, () => ${load(name(file))});`)
    .join("\n");

const absolute = (file: string) => `at(${JSON.stringify(file)})`;
const relative = (file: string) => `["." , ${JSON.stringify(file)}].join("/")`;
const fileURL = (file: string) => `url(at(${JSON.stringify(file)}))`;

const kindsImported =
  `plain.js: {"kind":"js"} js\nmodule.mjs: {"kind":"mjs"} mjs\ncommon.cjs: {"kind":"cjs","named":"cjs"} cjs\n` +
  `typed.ts: {"kind":"ts"} ts\nview.tsx: {"kind":"tsx"} (value) => value\nview.jsx: {"kind":"jsx"} jsx\ndata.json: {"kind":"json","named":"json"} json\n`;

const cases: Record<string, Case> = {
  "import() of an absolute path": {
    program: { "main.ts": prelude + everyKind(path => `import(${path})`, absolute) },
    disk: kinds,
    prints: kindsImported,
  },
  "import() of a file: URL": {
    program: { "main.ts": prelude + everyKind(path => `import(${path})`, fileURL) },
    disk: kinds,
    prints: kindsImported,
  },
  "import() of what import.meta.resolve answers": {
    program: { "main.ts": prelude + everyKind(path => `import(import.meta.resolve(${path}))`, absolute) },
    disk: kinds,
    prints: kindsImported,
  },
  "require() of an absolute path": {
    program: { "main.ts": prelude + everyKind(path => `require(${path})`, absolute) },
    disk: kinds,
    prints: kindsImported,
  },
  "require() in a CommonJS file, of what require.resolve answers": {
    program: {
      "main.ts": `import "./loads.cjs";`,
      "loads.cjs": `const folder = process.argv[2];
        for (const file of ${JSON.stringify(Object.keys(kinds))}) {
          const loaded = require(require.resolve([folder, file].join("/")));
          console.log(file + ":", JSON.stringify(loaded.default ?? loaded), typeof loaded.named);
        }`,
    },
    disk: kinds,
    prints:
      `plain.js: {"kind":"js"} string\nmodule.mjs: {"kind":"mjs"} string\ncommon.cjs: {"kind":"cjs","named":"cjs"} string\n` +
      `typed.ts: {"kind":"ts"} string\nview.tsx: {"kind":"tsx"} function\nview.jsx: {"kind":"jsx"} string\ndata.json: {"kind":"json","named":"json"} string\n`,
  },
  "createRequire(), module.require() and import.meta.require()": {
    program: {
      "main.ts":
        prelude +
        `import { createRequire } from "node:module";
        await shown("createRequire of the folder", () => createRequire(at("x.js"))(["." , "common.cjs"].join("/")));
        await shown("createRequire of the program", () => createRequire(import.meta.url)(at("typed.ts")));
        await shown("import.meta.require", () => import.meta.require(at("plain.js")));
        await shown("module.require", () => require("./holder.cjs")(at("common.cjs")));`,
      "holder.cjs": `module.exports = path => module.require(path);`,
    },
    disk: kinds,
    prints:
      `createRequire of the folder: {"kind":"cjs","named":"cjs"} cjs\ncreateRequire of the program: {"kind":"ts"} ts\n` +
      `import.meta.require: {"kind":"js"} js\nmodule.require: {"kind":"cjs","named":"cjs"} cjs\n`,
  },
  "a path relative to the working directory": {
    program: {
      "main.ts":
        prelude +
        everyKind(path => `import(${path})`, relative) +
        everyKind(path => `require(${path})`, relative) +
        `await shown("resolved against the working directory", () => import(require("node:path").resolve(["typed", "ts"].join("."))));`,
    },
    disk: kinds,
    prints: "",
  },
  "a file that is not there, and a file that does not parse": {
    program: {
      "main.ts":
        prelude +
        `await shown("import of nothing", () => import(at("nothing.ts")));
        await shown("require of nothing", () => require(at("nothing.ts")));
        await shown("import of a syntax error", () => import(at("broken.ts")));
        await shown("require of a syntax error", () => require(at("broken.ts")));
        await shown("import of a file that throws", () => import(at("throws.ts")));
        await shown("the same again", () => import(at("throws.ts")));
        await shown("require of a file that throws", () => require(at("throws.cjs")));`,
    },
    disk: {
      "broken.ts": `export const = ;`,
      "throws.ts": `throw new RangeError("from the file");`,
      "throws.cjs": `throw new RangeError("from the file");`,
    },
    prints: "",
  },
  "what such a file imports: files beside it, packages in node_modules on disk": {
    program: { "main.ts": prelude + `await shown("plugin", () => import(at("plugins", "plugin.ts")));` },
    flags: ["--compile-autoload-package-json"],
    disk: {
      "plugins/plugin.ts": `import { helper } from "./lib/helper";
        import legacy from "./lib/legacy.cjs";
        import settings from "../settings.json";
        import pkg, { version } from "a-package";
        import { sub } from "a-package/sub";
        import scoped from "@scope/other";
        const late = await import("./lib/late.mjs");
        export default { helper: helper(2), legacy: legacy.name, settings: settings.level, pkg: pkg(), version, sub, scoped, late: late.value, required: require("./lib/legacy.cjs") === legacy };`,
      "plugins/lib/helper.ts": `export function helper(n: number): number { return n * 21; }`,
      "plugins/lib/legacy.cjs": `exports.name = "legacy " + require("a-package/sub").sub;`,
      "plugins/lib/late.mjs": `export const value = "late";`,
      "settings.json": `{ "level": 3 }`,
      "node_modules/a-package/package.json": `{ "name": "a-package", "version": "1.2.3", "exports": { ".": { "import": "./index.mjs", "require": "./index.cjs" }, "./sub": "./sub.js" } }`,
      "node_modules/a-package/index.mjs": `export default () => "esm"; export const version = "1.2.3";`,
      "node_modules/a-package/index.cjs": `module.exports = () => "cjs";`,
      "node_modules/a-package/sub.js": `exports.sub = "sub";`,
      "node_modules/@scope/other/package.json": `{ "name": "@scope/other", "main": "main.js" }`,
      "node_modules/@scope/other/main.js": `module.exports = "scoped";`,
    },
    prints: `plugin: {"helper":42,"legacy":"legacy sub","settings":3,"pkg":"esm","version":"1.2.3","sub":"sub","scoped":"scoped","late":"late","required":true}\n`,
  },
  "what such a file imports: built-in modules that the program uses too": {
    program: {
      "main.ts":
        prelude +
        `import { EventEmitter } from "node:events";
        import * as path from "node:path";
        import * as fs from "node:fs";
        const plugin = await import(at("plugin.ts"));
        console.log(plugin.Emitter === EventEmitter, plugin.join === path.join, plugin.read === fs.readFileSync);
        const emitter = new EventEmitter();
        emitter.on("said", (word: string) => console.log("the program heard", word));
        plugin.speak(emitter);
        console.log(plugin.made instanceof EventEmitter, plugin.made.listenerCount("x"));`,
    },
    disk: {
      "plugin.ts": `import { EventEmitter } from "node:events";
        import { join } from "node:path";
        import { readFileSync } from "node:fs";
        export { EventEmitter as Emitter, join, readFileSync as read };
        export function speak(emitter: EventEmitter) { emitter.emit("said", join("a", "b")); }
        export const made = new EventEmitter().on("x", () => {});`,
    },
    prints: "true true true\nthe program heard a/b\ntrue 1\n",
  },
  "what such a file imports: built-in modules that the program never names": {
    program: { "main.ts": prelude + `await shown("plugin", () => import(at("plugin.ts")));` },
    disk: {
      "plugin.ts": `import { createHash } from "node:crypto";
        import { gzipSync, gunzipSync } from "node:zlib";
        import { parseArgs, inspect } from "node:util";
        import { Readable } from "node:stream";
        import * as os from "node:os";
        import * as dgram from "node:dgram";
        import * as readline from "node:readline";
        import { Database } from "bun:sqlite";
        import querystring from "querystring";
        const db = new Database(":memory:");
        const chunks: string[] = [];
        for await (const chunk of Readable.from(["a", "b"])) chunks.push(chunk);
        export default {
          hash: createHash("sha256").update("x").digest("hex").slice(0, 8),
          zip: gunzipSync(gzipSync("zipped")).toString(),
          args: parseArgs({ args: ["--n", "1"], options: { n: { type: "string" } } }).values.n,
          shown: inspect({ a: [1, { b: 2 }] }),
          chunks,
          eol: typeof os.EOL,
          dgram: typeof dgram.createSocket,
          readline: typeof readline.createInterface,
          row: db.query("select 1 + 1 as two").get(),
          query: querystring.stringify({ a: 1 }),
          required: typeof require("node:child_process").spawnSync,
          assert: typeof (await import("node:assert")).strictEqual,
        };`,
    },
    prints: `plugin: {"hash":"2d711642","zip":"zipped","args":"1","shown":"{ a: [ 1, { b: 2 } ] }","chunks":["a","b"],"eol":"string","dgram":"function","readline":"function","row":{"two":2},"query":"a=1","required":"function","assert":"function"}\n`,
  },
  "a path of which the build knows how it ends, and built-in modules of which the program holds a part": {
    program: {
      "main.ts":
        prelude +
        `import { Readable } from "node:stream";
        console.log(typeof Readable.from);
        await shown("import()", () => import(folder + "/plugin.ts"));
        await shown("require()", () => require(folder + "/common.cjs"));`,
    },
    disk: {
      "plugin.ts": `import { createHash } from "node:crypto";
        import * as http from "node:http";
        const server = http.createServer((request, response) => response.end("served"));
        await new Promise<void>(resolve => server.listen(0, resolve));
        const served = await (await fetch("http://localhost:" + (server.address() as { port: number }).port)).text();
        server.close();
        export default { hash: createHash("sha256").update("x").digest("hex").slice(0, 8), served };`,
      "common.cjs": kinds["common.cjs"],
    },
    prints: `function\nimport(): {"hash":"2d711642","served":"served"}\nrequire(): {"kind":"cjs","named":"cjs"} cjs\n`,
  },
  "built-in modules that are written for each other, of which the program names one": {
    program: {
      "main.ts":
        prelude +
        `import { validateHeaderName } from "node:_http_common";
        console.log(typeof validateHeaderName);
        await shown("import()", () => import(folder + "/plugin.ts"));`,
    },
    disk: {
      "plugin.ts": `import * as http from "node:http";
        const server = http.createServer((request, response) => {
          let body = "";
          request.on("data", chunk => (body += chunk));
          request.on("end", () => response.setHeader("x-a", "b").end("got " + body));
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        const answer = await new Promise<string>(resolve => {
          const options = { method: "POST", port: (server.address() as { port: number }).port, host: "127.0.0.1", agent: false };
          const request = http.request(options, response => {
            let text = "";
            response.on("data", chunk => (text += chunk));
            response.on("end", () => resolve([response.statusCode, response.headers["x-a"], text].join(" ")));
          });
          request.end("body");
        });
        server.close();
        export default { answer };`,
    },
    prints: `function\nimport(): {"answer":"200 b got body"}\n`,
  },
  "the two sides call each other, share objects, throw and await across the border": {
    program: {
      "main.ts":
        prelude +
        `import { Counter, registry, type Plugin } from "./host";
        const { default: plugin }: { default: Plugin } = await import(at("plugin.ts"));
        const counter = new Counter(40);
        console.log("plugin adds:", plugin.bump(counter, 2), counter.value, counter instanceof Counter);
        const made = plugin.make(Counter);
        console.log("plugin makes:", made.value, made instanceof Counter, made.add(1));
        console.log("plugin subclass:", plugin.subclass(Counter).add(1));
        const point = { x: 1, y: 2 };
        plugin.change(point);
        console.log("plugin changes:", JSON.stringify(point), Object.keys(point).join());
        try { plugin.fail(); } catch (error) { console.log("caught in the program:", error instanceof RangeError, (error as Error).message); }
        console.log("caught in the plugin:", plugin.guard(() => { throw new TypeError("from the program"); }));
        console.log("awaited:", await plugin.later(async (n: number) => n + 1, 1));
        try { await plugin.rejects(); } catch (error) { console.log("rejected:", (error as Error).message); }
        console.log("callbacks:", [1, 2, 3].map(plugin.double).join(), plugin.each([1, 2, 3], (n: number) => n * 3).join());
        for (const value of plugin.generate(3)) registry.push(value);
        console.log("registry:", registry.join());
        console.log("types that do not hold:", String(plugin.lies()), typeof plugin.lies());
        console.log("stored where a number was declared:", typeof counter.value, plugin.spoil(counter), typeof counter.value);`,
      "host.ts": `export class Counter {
          value: number;
          constructor(value: number) { this.value = value; }
          add(n: number): number { return (this.value += n); }
        }
        export const registry: number[] = [];
        export interface Plugin {
          bump(counter: Counter, by: number): number;
          make(type: typeof Counter): Counter;
          subclass(type: typeof Counter): Counter;
          change(point: { x: number; y: number }): void;
          fail(): never;
          guard(run: () => void): string;
          later(step: (n: number) => Promise<number>, from: number): Promise<number>;
          rejects(): Promise<never>;
          double(n: number): number;
          each(list: number[], f: (n: number) => number): number[];
          generate(n: number): Iterable<number>;
          lies(): number;
          spoil(counter: Counter): string;
        }`,
    },
    disk: {
      "plugin.ts": `export default {
          bump(counter: any, by: number) { return counter.add(by); },
          make(type: any) { return new type(7); },
          subclass(type: any) { return new (class extends type { add(n: number) { return super.add(n) * 100; } })(1); },
          change(point: any) { point.x = "one"; delete point.y; point.z = 3; },
          fail() { throw new RangeError("from the plugin"); },
          guard(run: () => void) { try { run(); return "nothing"; } catch (error: any) { return error.name + ": " + error.message; } },
          async later(step: (n: number) => Promise<number>, from: number) { return (await step(await step(from))) * 10; },
          async rejects() { await null; throw new Error("rejected by the plugin"); },
          double(n: number) { return n * 2; },
          each(list: number[], f: (n: number) => number) { return list.map(f); },
          *generate(n: number) { for (let i = 0; i < n; i++) yield i; },
          lies() { return "no number"; },
          spoil(counter: any) { counter.value = "text"; return "spoiled"; },
        };`,
    },
    prints: "",
  },
  "Bun.plugin(): a host hands its own modules to a file from disk through a virtual module": {
    program: {
      "main.ts":
        prelude +
        `import * as sdk from "./sdk";
        import { calls, Tool } from "./sdk";
        Bun.plugin({
          name: "host",
          setup(build) {
            build.module("host-sdk", () => ({ exports: sdk, loader: "object" }));
            build.onResolve({ filter: /^host:/ }, args => ({ path: args.path.slice(5), namespace: "host" }));
            build.onLoad({ filter: /.*/, namespace: "host" }, args => args.path === "sdk" ? { exports: sdk, loader: "object" } : { contents: "export default " + JSON.stringify(args.path.toUpperCase()), loader: "js" });
            build.onLoad({ filter: /\.shout$/ }, async args => ({ contents: "export default " + JSON.stringify((await Bun.file(args.path).text()).trim().toUpperCase()), loader: "js" }));
          },
        });
        const plugin = await import(at("plugin.ts"));
        console.log(plugin.tool instanceof Tool, plugin.tool.run(20), calls.join());
        console.log(plugin.sameByNamespace, plugin.text, plugin.shout, plugin.required);`,
      "sdk.ts": `export const calls: string[] = [];
        export class Tool {
          constructor(readonly name: string, readonly work: (n: number) => number) {}
          run(n: number): number { calls.push(this.name); return this.work(n) + 1; }
        }
        export function define(name: string, work: (n: number) => number): Tool { calls.push("define"); return new Tool(name, work); }`,
    },
    disk: {
      "plugin.ts": `import { define, Tool } from "host-sdk";
        import * as again from "host:sdk";
        import text from "host:words";
        import shout from "./note.shout";
        export const tool = define("double", (n: number) => n * 2);
        export const sameByNamespace = again.Tool === Tool;
        export { text, shout };
        export const required = require("host-sdk").Tool === Tool;`,
      "note.shout": "quiet\n",
    },
    prints: "true 41 define,double\ntrue WORDS QUIET true\n",
  },
  // A bundle holds a file twice that is an entry point and is imported by another one. Compiled ahead of time it is one module.
  "an entry point named by a file from disk is the compiled module, and runs once": {
    program: {
      "main.ts":
        prelude +
        `import { state } from "./shared";
        state.count++;
        const plugin = await import(at("plugin.ts"));
        console.log(await plugin.seen(import.meta.resolve("./shared.ts")), state.count);`,
      "shared.ts": `console.log("shared runs"); export const state = { count: 0 };`,
    },
    entryPoints: ["shared.ts"],
    disk: {
      "plugin.ts": `export async function seen(path: string) { const { state } = await import(path); return state.count++; }`,
    },
    prints: "shared runs\nshared runs\n0 1\n",
    differs: "shared runs\n1 2\n",
  },
  "a file with code that the executable carries as an asset": {
    program: {
      "main.ts":
        prelude +
        `import carried from "./carried.js" with { type: "file" };
        await shown("import", () => import(carried));
        await shown("require", () => require(carried));`,
      "carried.js": `export default { kind: "carried" }; export const named = "asset";`,
    },
    disk: {},
    prints: `import: {"kind":"carried"} asset\nrequire: {"kind":"carried"} asset\n`,
  },
  "a file is loaded once, is listed in require.cache, and runs again when it is taken out": {
    program: {
      "main.ts":
        prelude +
        `const path = at("counts.cjs");
        console.log(require(path).n, require(path).n, Object.keys(require.cache).filter(key => key.endsWith("counts.cjs")).length);
        delete require.cache[require.resolve(path)];
        console.log(require(path).n, (await import(at("once.mjs"))).n, (await import(at("once.mjs"))).n);`,
    },
    disk: {
      "counts.cjs": `globalThis.loads = (globalThis.loads ?? 0) + 1; exports.n = globalThis.loads;`,
      "once.mjs": `globalThis.imports = (globalThis.imports ?? 0) + 1; export const n = globalThis.imports;`,
    },
    prints: "1 1 1\n2 1 1\n",
  },
  "import.meta, __filename and the stack of a file from disk": {
    program: {
      "main.ts":
        prelude +
        `const short = (text: string) => text.replaceAll(folder, "<folder>");
        const esm = await import(at("where.ts"));
        console.log(short(esm.meta.join(" ")), esm.main);
        console.log(short(require(at("where.cjs")).join(" ")));
        console.log(short(esm.trace().includes("where.ts") ? "the stack names the file" : "the stack does not name the file"));`,
    },
    disk: {
      "where.ts": `export const meta = [import.meta.path, import.meta.dir, import.meta.file, import.meta.url]; export const main = import.meta.main; export function trace(): string { return new Error("x").stack!; }`,
      "where.cjs": `module.exports = [__filename, __dirname, module.id, String(require.main === module)];`,
    },
    prints:
      "<folder>/where.ts <folder> where.ts file://<folder>/where.ts false\n<folder>/where.cjs <folder> <folder>/where.cjs false\nthe stack names the file\n",
  },
  "a config file in every form that tools look for": {
    program: {
      "main.ts":
        prelude +
        `import { existsSync } from "node:fs";
        for (const name of ["tool.config.ts", "tool.config.mjs", "tool.config.cjs", "tool.config.js", ".toolrc.json"]) {
          if (!existsSync(at(name))) continue;
          const loaded = await import(url(at(name)));
          const config = typeof loaded.default === "function" ? await loaded.default({ mode: "test" }) : loaded.default;
          console.log(name, JSON.stringify(config), config.plugins?.map((plugin: any) => plugin.name + ":" + plugin.apply("x")).join());
        }`,
    },
    disk: {
      "tool.config.ts": `import type { X } from "./types"; import local from "./local-plugin"; export default async ({ mode }: { mode: string }) => ({ mode, plugins: [local({ loud: true })] });`,
      "local-plugin.ts": `export default (options: { loud: boolean }) => ({ name: "local", apply: (text: string) => (options.loud ? text.toUpperCase() : text) });`,
      "tool.config.mjs": `export default { mode: "mjs" };`,
      "tool.config.cjs": `module.exports = { mode: "cjs", plugins: [{ name: "inline", apply: text => text + text }] };`,
      ".toolrc.json": `{ "mode": "json" }`,
    },
    prints:
      `tool.config.ts {"mode":"test","plugins":[{"name":"local"}]} local:X\ntool.config.mjs {"mode":"mjs"} undefined\n` +
      `tool.config.cjs {"mode":"cjs","plugins":[{"name":"inline"}]} inline:xx\n.toolrc.json {"mode":"json"} undefined\n`,
  },
  "a program that loads files takes the options that load a file in front of it": {
    program: {
      "main.ts":
        prelude + `await shown("plugin", () => import(at("plain.js")));\nconsole.log((globalThis as any).order);`,
    },
    env: { BUN_OPTIONS: "--preload ./first.ts -r ./second.cjs --import ./third.mjs" },
    disk: {
      ...kinds,
      "first.ts": `(globalThis as any).order = ["preload"];`,
      "second.cjs": `globalThis.order.push("require");`,
      "third.mjs": `globalThis.order.push("import");`,
    },
    prints: `plugin: {"kind":"js"} js\n[ "preload", "require", "import" ]\n`,
  },
  "so it does without the text of its functions": {
    program: {
      "main.ts":
        prelude + `await shown("plugin", () => import(at("plain.js")));\nconsole.log((globalThis as any).order);`,
    },
    aotFlags: ["--no-compile-function-source"],
    env: { BUN_OPTIONS: "--preload ./first.ts" },
    disk: { ...kinds, "first.ts": `(globalThis as any).order = ["preload"];` },
    prints: `plugin: {"kind":"js"} js\n[ "preload" ]\n`,
  },
  // The first file writes the second, which names the entry point as the executable at hand does.
  "a file in front of the program imports the entry point, and a file of the program asks for it while it is loaded": {
    program: {
      "main.ts":
        prelude +
        `import "./asks.cjs";
        import "./last.cjs";
        console.log("the entry point runs");
        export const answer = 42;
        if (process.argv.length > 3) void import(at("plain.js"));`,
      "asks.cjs": `console.log("a file of the program asks");
        import("./main.ts").then(namespace => console.log("it gets", namespace.answer));`,
      "last.cjs": `console.log("the last file runs");`,
    },
    env: { BUN_OPTIONS: "--preload ./writes.cjs --preload ./written.mjs" },
    disk: {
      "writes.cjs": `require("node:fs").writeFileSync("written.mjs", "import { answer } from " + JSON.stringify(Bun.main) + ';\\nconsole.log("the file in front gets", answer);\\n');`,
      "written.mjs": "",
    },
    prints:
      "a file of the program asks\nthe last file runs\nthe entry point runs\nthe file in front gets 42\nit gets 42\n",
  },
  // A bundle runs the module that throws in front of the CommonJS file. Compiled ahead of time the files run in the order of `bun run`.
  "a file of the program that requires the entry point then catches what a module of the graph throws": {
    program: {
      "main.ts":
        prelude +
        `import "./asks.cjs";
        import "./throws.ts";
        console.log("the entry point runs");
        export const answer = 42;
        if (process.argv.length > 3) void import(at("plain.js"));`,
      "asks.cjs": `console.log("a file of the program asks");
        try {
          console.log("it gets", require("./main.ts").answer);
        } catch (error) {
          console.log("it catches", error.name, error.message);
        }`,
      "throws.ts": `console.log("the last module runs");
        throw new RangeError("thrown by the last module");`,
    },
    env: { BUN_OPTIONS: "--preload ./writes.cjs --preload ./written.mjs" },
    disk: {
      "writes.cjs": `process.on("uncaughtException", error => console.log("nobody catches", error.name, error.message));
        require("node:fs").writeFileSync("written.mjs", "import " + JSON.stringify(Bun.main) + ";");`,
      "written.mjs": "",
    },
    prints: "the last module runs\nnobody catches RangeError thrown by the last module\n",
    differs:
      "a file of the program asks\nthe last module runs\nit catches RangeError thrown by the last module\nnobody catches RangeError thrown by the last module\n",
  },
  "text that is evaluated loads files where the program does": {
    program: {
      "main.ts":
        prelude +
        `await shown("plugin", () => import(at("plain.js")));
        await shown("import() in eval", () => (0, eval)("import(" + JSON.stringify(at("module.mjs")) + ")"));
        await shown("import() in new Function", () => new Function("path", "return import(path)")(at("typed.ts")));
        await shown("require() in new Function", () => new Function("require", "path", "return require(path)")(require, at("common.cjs")));`,
    },
    disk: kinds,
    prints: `plugin: {"kind":"js"} js\nimport() in eval: {"kind":"mjs"} mjs\nimport() in new Function: {"kind":"ts"} ts\nrequire() in new Function: {"kind":"cjs","named":"cjs"} cjs\n`,
  },
  "without the text of its functions an executable still loads files": {
    program: {
      "main.ts":
        prelude +
        `function secret(): number { return 41; }
        const plugin = await import(at("plugin.ts"));
        console.log(plugin.default(secret), new Function("n", "return n + 1")(1), String(plugin.default).includes("call"));`,
    },
    aotFlags: ["--no-compile-function-source"],
    disk: { "plugin.ts": `export default function call(f: () => number) { return f() + 1; }` },
    prints: "42 2 true\n",
  },
  "the path of a carried file comes through a constant, another file or a namespace object": {
    program: {
      "main.ts":
        prelude +
        `import carried from "./carried.js" with { type: "file" };
        import * as all from "./carried.js" with { type: "file" };
        import handedOn, { kept } from "./between.ts";
        const alias = carried;
        await shown("a constant", () => import(alias));
        await shown("a constant of another file", () => require(kept));
        await shown("the default export of another file", () => import(handedOn));
        await shown("a namespace object", () => require(all.default));
        await shown("a longer text", () => import("" + carried));
        await shown("import.meta.require", () => import.meta.require(kept));
        console.log(require.resolve(carried) === carried, require.resolve(kept) === carried);`,
      "between.ts": `import given from "./carried.js" with { type: "file" };
        export const kept = given;
        export default given;`,
      "carried.js": `export default { kind: "carried" }; export const named = "asset";`,
    },
    disk: {},
    prints: `a constant: {"kind":"carried"} asset\na constant of another file: {"kind":"carried"} asset\nthe default export of another file: {"kind":"carried"} asset\na namespace object: {"kind":"carried"} asset\na longer text: {"kind":"carried"} asset\nimport.meta.require: {"kind":"carried"} asset\ntrue true\n`,
  },
};

const allowed = ["--aot", "--aot-allow-code-from-disk"];
// On Windows a function of the library makes process.env, which says which program to run.
const withoutBuiltInModules = isWindows ? [] : ["--no-builtin-modules"];

const closedWorld: Record<string, string> = {
  "program/tsconfig.json": tsconfig,
  "program/main.ts":
    prelude +
    `await shown("import", () => import(at("typed.ts")));
    await shown("require", () => require(at("common.cjs")));
    await shown("data", () => import(at("data.json")));
    await import(at("typed.ts")).catch((error: Error) => console.log("the error names the option:", error.message.includes("--aot-allow-code-from-disk")));`,
  ...Object.fromEntries(Object.entries(kinds).map(([file, text]) => ["disk/" + file, text])),
};

function foldersOf(dir: { toString(): string }) {
  return { folder: String(dir), disk: join(String(dir), "disk").replaceAll("\\", "/") };
}

const isAboutTheEntryPoint = (it: Case) =>
  it.entryPoints !== undefined || Object.values(it.disk).some(text => text.includes("Bun.main"));
const groups = Map.groupBy(Object.entries(cases), ([name, it]) =>
  JSON.stringify([it.flags ?? [], it.aotFlags ?? [], isAboutTheEntryPoint(it) ? name : ""]),
);

// A hardened Bun builds executables that run only what was compiled into them.
describe.skipIf(isHardened)("code from disk", () => {
  for (const group of groups.values()) {
    const [[firstName, first]] = group;
    const isShared = !isAboutTheEntryPoint(first);
    describe(
      isShared ? `built with ${[...allowed, ...(first.flags ?? []), ...(first.aotFlags ?? [])].join(" ")}` : firstName,
      () => {
        const files: Record<string, string> = { "program/tsconfig.json": tsconfig };
        for (const [index, [, it]] of group.entries()) {
          for (const [file, text] of Object.entries(it.program))
            files[`program/${isShared ? index + "/" : ""}${file}`] = text;
          for (const [file, text] of Object.entries(it.disk)) files[`disk/${index}/${file}`] = text;
        }
        if (isShared)
          files["program/main.ts"] =
            `const programs: Record<string, () => Promise<unknown>> = {\n` +
            group.map((_, index) => `  "${index}": () => import("./${index}/main.ts"),\n`).join("") +
            `};\nawait programs[process.env.PROGRAM!]!();\n`;
        const isLargest = isShared && !first.flags && !first.aotFlags;
        if (isLargest)
          files["program/build.ts"] = `const result = await Bun.build({
  entrypoints: ["./main.ts"],
  compile: { aot: true, allowCodeFromDisk: true, outfile: process.argv[2] },
});
console.log(result.success, result.logs.filter(log => log.message.includes("TS100064")).length);
`;
        const dir = tempDir("aot-code-from-disk", files);
        const folder = String(dir);
        const executables: Record<"plain" | "compiled", string> = { plain: "", compiled: "" };

        beforeAll(async () => {
          const build = async (name: "plain" | "compiled", flags: string[]) => {
            executables[name] = join(folder, name + (isWindows ? ".exe" : ""));
            const entryPoints = ["main.ts", ...(first.entryPoints ?? [])];
            built(
              await spawned(
                [
                  bunExe(),
                  "build",
                  "--compile",
                  ...flags,
                  ...(first.flags ?? []),
                  ...entryPoints,
                  "--outfile",
                  executables[name],
                ],
                join(folder, "program"),
                bunEnv,
              ),
            );
          };
          const buildThroughTheApi = async () => {
            executables.compiled = join(folder, "compiled" + (isWindows ? ".exe" : ""));
            const { stdout, stderr, exitCode } = await spawned(
              [bunExe(), "build.ts", executables.compiled],
              join(folder, "program"),
              bunEnv,
            );
            expect({ stdout, stderr: exitCode ? stderr : "", exitCode }).toEqual({
              stdout: "true 0\n",
              stderr: "",
              exitCode: 0,
            });
          };
          await Promise.all([
            build("plain", []),
            isLargest
              ? buildThroughTheApi()
              : build("compiled", [...allowed, ...withoutBuiltInModules, ...(first.aotFlags ?? [])]),
          ]);
        }, timeout);

        for (const [index, [name, it]] of group.entries()) {
          test(
            isShared ? name : "answers as without --aot",
            async () => {
              const disk = join(folder, "disk", String(index));
              mkdirSync(disk, { recursive: true });
              const run = async (executable: string) => {
                const { stdout, stderr, exitCode, signal } = await spawned(
                  [executable, disk.replaceAll("\\", "/")],
                  disk,
                  {
                    ...bunEnv,
                    ...it.env,
                    PROGRAM: String(index),
                  },
                );
                return { stdout, stderr: exitCode === 0 ? "" : stderr, exitCode, signal };
              };
              const plain = await run(executables.plain);
              // What is printed names files, and Windows spells them otherwise: there the build without --aot alone says what is right.
              const prints = (!isWindows && it.prints) || expect.any(String);
              expect(plain).toEqual({ stdout: prints, stderr: "", exitCode: 0, signal: null });
              expect(await run(executables.compiled)).toEqual(
                it.differs === undefined ? plain : { ...plain, stdout: it.differs },
              );
            },
            timeout,
          );
        }
      },
    );
  }
});

describe("the option", () => {
  test(
    "without the option an executable refuses the code and loads the data, and the build and the error name the option",
    () =>
      (async () => {
        using dir = tempDir("aot-code-from-disk", closedWorld);
        const { folder, disk } = foldersOf(dir);
        const executable = join(folder, "closed" + (isWindows ? ".exe" : ""));
        const build = await spawned(
          [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", executable],
          join(folder, "program"),
          bunEnv,
        );
        built(build);
        expect(build.stderr).toMatch(/^warn: TS100064: .* or build with --aot-allow-code-from-disk$/m);
        const { stdout, exitCode } = await spawned([executable, disk], disk, bunEnv);
        expect({ stdout, exitCode }).toEqual({
          stdout: `import: threw Error ERR_MODULE_NOT_FOUND\nrequire: threw Error MODULE_NOT_FOUND\ndata: {"kind":"json","named":"json"} json\nthe error names the option: true\n`,
          exitCode: 0,
        });
      })(),
    timeout,
  );

  test("the option requires --aot", async () => {
    using dir = tempDir("aot-code-from-disk", { "main.ts": "console.log(1);" });
    const { stderr, exitCode } = await spawned(
      [bunExe(), "build", "--compile", "--aot-allow-code-from-disk", "main.ts", "--outfile", "main"],
      String(dir),
      bunEnv,
    );
    expect({ stderr: stderr.trim(), exitCode }).toEqual({
      stderr: "error: --aot-allow-code-from-disk requires --aot",
      exitCode: 1,
    });
  });
});
