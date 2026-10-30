#!/usr/bin/env python3
"""exports-reached-from-outside.py <folder>: ONE CASE A FOLDER: every way to reach, FROM OUTSIDE WHAT THE BUILD SEES, an export that no text of the program names: the compiler drops exports and functions that it proves unreachable, and takes module variables to "hold one function".
Each case is a folder with main.ts (or main.js | main.cjs | main.test.ts); lib.ts is the same everywhere."""
import os, sys
out = sys.argv[1]

LIB = '''let hook: () => string = () => "the first hook";
export function setHook(next: () => string): void { hook = next; }
export function callHook(): string { return hook(); }
export function hidden(): string { return "hidden was reached"; }
export const hiddenArrow = (): string => "hiddenArrow was reached";
export const hiddenTable: { a: number; b: string } = { a: 1, b: "two" };
export class HiddenClass { value = 5; method(): string { return "HiddenClass.method was reached " + this.value; } static made(): string { return "HiddenClass.made was reached"; } }
export let unseenCount = 0;
export function bump(): number { return ++unseenCount; }
export default function hiddenDefault(): string { return "the default was reached"; }
export function unrelated(): string { return "unrelated"; }
'''
# what is done to a namespace object that came by a road the build cannot follow: `ns` is in scope, typed any
DEEDS = '''const word = (parts: string[]): string => parts.join("");
function deeds(ns: any): void {
  console.log("keys", Object.keys(ns).join());
  console.log("hidden", ns[word(["hid", "den"])]());
  console.log("hiddenArrow", ns[word(["hidden", "Arrow"])]());
  console.log("hiddenTable", JSON.stringify(ns[word(["hidden", "Table"])]));
  const K = ns[word(["Hidden", "Class"])]; console.log("HiddenClass", new K().method(), K.made());
  console.log("bump", ns[word(["bu", "mp"])](), ns[word(["hidden", "Count"])]);
  console.log("default", ns[word(["def", "ault"])]());
  console.log("before", ns.callHook()); ns[word(["set", "Hook"])](() => "the second hook"); console.log("after", ns.callHook());
}
'''
HEAD = 'import { callHook, unrelated } from "./lib.ts";\nconsole.log(unrelated(), callHook());\n'
FOLLOWED = 'const followed = await import("./lib.ts"); console.log(followed.unrelated());\n'  # makes the namespace object's maker exist, followed and with nothing getting away
TAIL = 'console.log("in main afterwards", callHook());\n'
PLUGIN_STATIC = 'import * as ns from "./lib.ts";\n' + DEEDS.replace(": string[]", "").replace("): string =>", ") =>").replace("(ns: any): void", "(ns)") + 'export function run() { deeds(ns); }\n'
PLUGIN_NAMED = 'import { hidden, hiddenArrow, hiddenTable, HiddenClass, bump, unseenCount, setHook, callHook } from "./lib.ts";\nimport d from "./lib.ts";\nexport function run() { console.log(hidden(), hiddenArrow(), JSON.stringify(hiddenTable), new HiddenClass().method(), HiddenClass.made(), bump(), unseenCount, d()); console.log(callHook()); setHook(() => "the second hook"); console.log(callHook()); }\n'
PLUGIN_DYNAMIC = DEEDS.replace(": string[]", "").replace("): string =>", ") =>").replace("(ns: any): void", "(ns)") + 'export async function run() { deeds(await import("./lib.ts")); }\n'
PLUGIN_REQUIRE = DEEDS.replace(": string[]", "").replace("): string =>", ") =>").replace("(ns: any): void", "(ns)") + 'exports.run = function () { deeds(require("./lib.ts")); };\n'
COMPUTED = 'const at = (name: string): string => process.cwd() + "/" + name;\n'

cases = {}
def case(name, files): cases[name] = {"lib.ts": LIB, **files}

for followed in (0, 1):
    f = FOLLOWED if followed else ""; t = "-beside-a-followed-import" if followed else ""
    case("unseen-file-imports-the-namespace" + t, {"main.ts": HEAD + f + COMPUTED + 'const plugin: any = await import(at("plugin.js")); plugin.run();\n' + TAIL, "plugin.js": PLUGIN_STATIC})
    case("unseen-file-imports-by-name" + t, {"main.ts": HEAD + f + COMPUTED + 'const plugin: any = await import(at("plugin.js")); plugin.run();\n' + TAIL, "plugin.js": PLUGIN_NAMED})
    case("unseen-file-imports-dynamically" + t, {"main.ts": HEAD + f + COMPUTED + 'const plugin: any = await import(at("plugin.js")); await plugin.run();\n' + TAIL, "plugin.js": PLUGIN_DYNAMIC})
    case("unseen-commonjs-file-requires" + t, {"main.ts": HEAD + f + COMPUTED + 'const plugin: any = require(at("plugin.cjs")); plugin.run();\n' + TAIL, "plugin.cjs": PLUGIN_REQUIRE})
    case("import-of-a-computed-path" + t, {"main.ts": HEAD + f + COMPUTED + DEEDS + 'deeds(await import(at("lib.ts")));\n' + TAIL})
    case("import-of-a-computed-relative-name" + t, {"main.ts": HEAD + f + DEEDS + 'const name: string = ["./lib", "ts"].join("."); deeds(await import(name));\n' + TAIL})
    case("require-of-a-computed-path" + t, {"main.ts": HEAD + f + COMPUTED + DEEDS + 'deeds(require(at("lib.ts")));\n' + TAIL})
    case("require-of-a-computed-relative-name" + t, {"main.ts": HEAD + f + DEEDS + 'const name: string = ["./lib", "ts"].join("."); deeds(require(name));\n' + TAIL})
    case("import-meta-require-computed" + t, {"main.ts": HEAD + f + COMPUTED + DEEDS + 'deeds((import.meta as any).require(at("lib.ts")));\n' + TAIL})
    case("create-require-computed" + t, {"main.ts": 'import { createRequire } from "node:module";\n' + HEAD + f + COMPUTED + DEEDS + 'deeds(createRequire(import.meta.url)(at("lib.ts")));\n' + TAIL})
    case("create-require-literal" + t, {"main.ts": 'import { createRequire } from "node:module";\n' + HEAD + f + DEEDS + 'const r = createRequire(import.meta.url); deeds(r("./lib.ts"));\n' + TAIL})
    case("import-in-an-indirect-eval" + t, {"main.ts": HEAD + f + COMPUTED + DEEDS + 'deeds(await (0, eval)("import(" + JSON.stringify(at("lib.ts")) + ")"));\n' + TAIL})
    case("import-in-a-direct-eval" + t, {"main.ts": HEAD + f + DEEDS + 'deeds(await eval(\'import("./lib.ts")\'));\n' + TAIL})
    case("import-in-a-made-function" + t, {"main.ts": HEAD + f + COMPUTED + DEEDS + 'deeds(await new Function("path", "return import(path)")(at("lib.ts")));\n' + TAIL})
    case("import-of-a-resolved-url" + t, {"main.ts": HEAD + f + DEEDS + 'deeds(await import(import.meta.resolve("./lib.ts")));\n' + TAIL})
    case("import-of-a-file-url" + t, {"main.ts": HEAD + f + DEEDS + 'deeds(await import(new URL("./lib.ts", import.meta.url).href));\n' + TAIL})
    case("require-cache" + t, {"main.ts": HEAD + f + DEEDS + 'const first: any = require("./lib.ts"); console.log(first.unrelated()); const key = Object.keys(require.cache).find(k => k.endsWith("lib.ts")); console.log("in the cache", key !== undefined); if (key) deeds((require.cache as any)[key].exports);\n' + TAIL})
    case("eval-of-the-name-of-a-namespace" + t, {"main.ts": 'import * as whole from "./lib.ts";\n' + HEAD + f + DEEDS + 'console.log(whole.unrelated()); deeds(eval("whole"));\n' + TAIL})
    case("eval-of-a-local-that-holds-it" + t, {"main.ts": HEAD + f + DEEDS + 'async function go(): Promise<void> { const ns = await import("./lib.ts"); console.log(ns.unrelated()); deeds(eval("ns")); }\nawait go();\n' + TAIL})
    case("eval-reads-the-member" + t, {"main.ts": HEAD + f + 'async function go(): Promise<void> { const ns = await import("./lib.ts"); console.log(ns.unrelated()); console.log(eval("ns.hid" + "den()")); eval("ns.setH" + "ook(() => \'the second hook\')"); }\nawait go();\n' + TAIL})
    case("vm-run-in-this-context" + t, {"main.ts": 'import vm from "node:vm";\n' + HEAD + f + COMPUTED + DEEDS + 'deeds(await vm.runInThisContext("(p) => import(p)")(at("lib.ts")));\n' + TAIL})
    case("worker-imports-it" + t, {"main.ts": HEAD + f + COMPUTED + 'const w = new Worker(at("worker.js")); await new Promise<void>(done => { w.onmessage = (e: any) => { console.log(e.data); done(); }; w.onerror = () => { console.log("the worker failed"); done(); }; }); w.terminate();\n' + TAIL,
          "worker.js": 'import * as ns from "./lib.ts";\nconst k = ["hid", "den"].join("");\nns[["set", "Hook"].join("")](() => "the hook of the worker");\npostMessage([ns[k](), ns.callHook(), Object.keys(ns).join()].join(" | "));\n'})
    case("reexported-whole-and-reached-from-an-unseen-file" + t, {"main.ts": HEAD + f + 'import { unrelated as again } from "./index.ts"; console.log(again());\n' + COMPUTED + 'const plugin: any = await import(at("plugin.js")); plugin.run();\n' + TAIL, "index.ts": 'export * from "./lib.ts";\nexport * as lib from "./lib.ts";\n',
          "plugin.js": PLUGIN_STATIC.replace('import * as ns from "./lib.ts";', 'import * as index from "./index.ts";\nconst ns = { ...index.lib };') })
    case("commonjs-main-requires-computed" + t, {"main.cjs": 'const lib = require("./lib.ts"); console.log(lib.unrelated(), lib.callHook());\n' + DEEDS.replace(": string[]", "").replace("): string =>", ") =>").replace("(ns: any): void", "(ns)") + 'deeds(require(process.cwd() + "/lib.ts"));\nconsole.log("in main afterwards", lib.callHook());\n'})
    case("module-load" + t, {"main.ts": 'import Module from "node:module";\n' + HEAD + f + COMPUTED + DEEDS + 'deeds((Module as any)._load(at("lib.ts"), null, false));\n' + TAIL})
    case("preloaded-file-keeps-a-door" + t, {"main.ts": HEAD + f + 'await (globalThis as any).door();\n' + TAIL, "pre.js": PLUGIN_DYNAMIC.replace("export async function run()", "globalThis.door = async function ()"), "flags.txt": "--preload ./pre.js"})
case("a-module-that-exports-then", {"main.ts": 'const got: any = await import("./thenable.ts"); console.log("what the await yields", typeof got, String(got));\nimport { calls } from "./counts.ts"; console.log(calls.join());\n', "thenable.ts": 'import { calls } from "./counts.ts";\nexport function then(resolve: (v: unknown) => void): void { calls.push("then was called"); resolve("resolved by the module"); }\nexport function other(): string { return "other"; }\n', "counts.ts": 'export const calls: string[] = [];\n'})
case("a-module-that-exports-then-in-promise-all", {"main.ts": 'const [got]: any[] = await Promise.all([import("./thenable.ts")]); console.log("what the await yields", typeof got, String(got));\nimport { calls } from "./counts.ts"; console.log(calls.join());\n', "thenable.ts": 'import { calls } from "./counts.ts";\nexport function then(resolve: (v: unknown) => void): void { calls.push("then was called"); resolve("resolved by the module"); }\nexport function other(): string { return "other"; }\n', "counts.ts": 'export const calls: string[] = [];\n'})
case("a-module-that-exports-then-behind-then", {"main.ts": 'await import("./thenable.ts").then((got: any) => console.log("what the handler gets", typeof got, String(got)));\nimport { calls } from "./counts.ts"; console.log(calls.join());\n', "thenable.ts": 'import { calls } from "./counts.ts";\nexport function then(resolve: (v: unknown) => void): void { calls.push("then was called"); resolve("resolved by the module"); }\nexport function other(): string { return "other"; }\n', "counts.ts": 'export const calls: string[] = [];\n'})
case("a-handler-returns-the-namespace-of-a-module-that-exports-then", {"main.ts": 'import * as whole from "./thenable.ts";\nconst got: any = await Promise.resolve(1).then(() => whole); console.log(typeof got, String(got)); console.log(whole.other());\nimport { calls } from "./counts.ts"; console.log(calls.join());\n', "thenable.ts": 'import { calls } from "./counts.ts";\nexport function then(resolve: (v: unknown) => void): void { calls.push("then was called"); resolve("resolved by the module"); }\nexport function other(): string { return "other"; }\n', "counts.ts": 'export const calls: string[] = [];\n'})
case("printed-whole", {"main.ts": 'const ns = await import("./lib.ts"); console.log(ns.unrelated()); console.log(ns);\n'})
case("inspected-whole", {"main.ts": 'const ns = await import("./lib.ts"); console.log(ns.unrelated()); console.log(Bun.inspect(ns));\n'})
case("in-and-typeof-by-written-names", {"main.ts": 'const ns = await import("./lib.ts"); console.log(ns.unrelated(), "hidden" in ns, "setHook" in ns, "nothing" in ns, typeof ns.hidden, typeof ns.hiddenTable, typeof ns.HiddenClass, Object.hasOwn(ns, "hiddenArrow"));\n'})
case("the-member-is-read-and-not-called", {"main.ts": 'const ns = await import("./lib.ts"); const f = ns.hidden; const g = ns.setHook; console.log(ns.unrelated(), f.name, g.length, f(), ns.callHook()); g(() => "the second hook"); console.log(ns.callHook());\n'})
case("test-file-spies", {"main.test.ts": 'import { test, expect, spyOn } from "bun:test";\nimport * as ns from "./lib.ts";\nimport { user } from "./user.ts";\ntest("a spy on an export", () => { const spy = spyOn(ns, "hidden").mockImplementation(() => "mocked"); console.log(user(), spy.mock.calls.length); spy.mockRestore(); console.log(user()); expect(1).toBe(1); });\n', "user.ts": 'import { hidden } from "./lib.ts";\nexport function user(): string { return hidden(); }\n'})
case("test-file-mocks-the-module", {"main.test.ts": 'import { test, expect, mock } from "bun:test";\nimport { user } from "./user.ts";\ntest("mock.module", async () => { console.log(user()); mock.module("./lib.ts", () => ({ hidden: () => "mocked", callHook: () => "mocked hook" })); console.log(user()); const again = await import("./lib.ts"); console.log(Object.keys(again).join(), again.hidden()); expect(1).toBe(1); });\n', "user.ts": 'import { hidden } from "./lib.ts";\nexport function user(): string { return hidden(); }\n'})
case("test-file-reaches-by-computed-names", {"main.test.ts": 'import { test, expect } from "bun:test";\nimport { callHook, unrelated } from "./lib.ts";\n' + DEEDS + 'test("by names", async () => { console.log(unrelated(), callHook()); const ns = await import("./lib.ts"); console.log(ns.unrelated()); const name: string = process.cwd() + "/lib.ts"; deeds(await import(name)); console.log(callHook()); expect(1).toBe(1); });\n'})

for name, files in cases.items():
    os.makedirs(f"{out}/{name}", exist_ok=True)
    for f, text in files.items():
        open(f"{out}/{name}/{f}", "w").write(text)
print(len(cases), "cases")
