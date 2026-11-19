// One program for each way in which a program can come by the path of a module. Each has a subject, seenFolder/seenSubject, whose path that way reads or finds, and a bystander,
// quietFolder/quietBystander, whose path nobody reads. Built with --obfuscate the program prints what it prints without, and the executable holds of the four names those that are listed:
// all four where a name that is made when the program runs may be that of any file.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "../harness/commands";
import { bytesAndStoredStrings } from "../harness/executable-bytes";
import { buildFlags } from "../harness/flags";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;
const names = ["seenFolder", "seenSubject", "quietFolder", "quietBystander"];

async function compile(folder: string, entry: string, name: string, ...flags: string[]) {
  built(await spawned([bunExe(), "compile", entry, "--outfile", name, ...flags], folder, env));
  return join(folder, isWindows ? name + ".exe" : name);
}

async function buildBoth(files: Record<string, string>, folder: string) {
  const entry = Object.keys(files).find(file => file.startsWith("main."))!;
  const reference = await spawned([await compile(folder, entry, "reference")], folder, env);
  const executable = await compile(folder, entry, "obfuscated", buildFlags.obfuscate);
  const obfuscated = await spawned([executable], folder, env);
  const bytes = bytesAndStoredStrings(executable);
  return { reference, obfuscated, held: names.filter(name => bytes.includes(name)) };
}

const ways: Record<string, { held: string[]; files: Record<string, string> }> = {
  "cache-entry-under-a-resolved-name": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.cjs":
        'const { quiet } = require("./quietFolder/quietBystander");\nconst { value } = require("./seenFolder/seenSubject");\nconst entry = require.cache[require.resolve("./seenFolder/seenSubject")];\nconsole.log(quiet(1), value, entry && entry.id, entry && entry.filename);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "cache-keys-of-require-cache": {
    held: [],
    files: {
      "main.cjs":
        'const { quiet } = require("./quietFolder/quietBystander");\nconst { value } = require("./seenFolder/seenSubject");\nconsole.log(quiet(1), value, Object.keys(require.cache).sort().join());\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "children-and-parent-of-module-objects": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.cjs":
        'const { quiet } = require("./quietFolder/quietBystander");\nconst { value, up } = require("./seenFolder/seenSubject.cjs");\nconsole.log(quiet(1), value, up, module.children.map(child => child.id).sort().join());\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.cjs": 'exports.value = "subject";\nexports.up = module.parent && module.parent.id;\n',
    },
  },
  "get-builtin-module-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst name = Buffer.from("bm9kZTpvcw==", "base64").toString(); // @ts-expect-error\nconsole.log(quiet(1), value, typeof process.getBuiltinModule(name).EOL);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "load-by-import-meta-require": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = import.meta.require("./seenFolder/" + made).value; } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "load-by-import-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = (await import("./seenFolder/" + made)).value; } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "load-by-main-module-require": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.cjs":
        'const { quiet } = require("./quietFolder/quietBystander");\nconst { value } = require("./seenFolder/seenSubject");\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = process.mainModule.require("./seenFolder/" + made).value; } catch (e) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "load-by-module-load": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nimport Module from "node:module";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { const loaded = (Module as any)._load(import.meta.dir + "/seenFolder/" + made + ".ts"); found = loaded === undefined ? "nothing" : loaded.value; } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "load-by-module-require": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.cjs":
        'const { quiet } = require("./quietFolder/quietBystander");\nconst { value } = require("./seenFolder/seenSubject");\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = module.require("./seenFolder/" + made).value; } catch (e) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "load-by-require-let-go": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nconst loader = [require][Number(made.length > 90)];\nlet found; try { found = loader("./seenFolder/" + made).value; } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "load-by-require-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = require("./seenFolder/" + made).value; } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "main-by-argv-bun-main-and-require-main": {
    held: [],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), value, process.argv[1], Bun.main, require.main && require.main.filename, import.meta.main);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "message-of-a-require-of-a-module-that-awaits": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { ask } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), ask());\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/awaits.mjs": "export const waited = await Promise.resolve(1);\n",
      "seenFolder/seenSubject.ts":
        'export const ask = () => { try { return require("./awaits.mjs"); } catch (e: any) { return e.name + ": " + e.message; } };\n',
    },
  },
  "message-of-a-require-that-finds-nothing": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { ask } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), ask());\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts":
        'export const ask = () => { try { return require("./nothing-here"); } catch (e: any) { return e.message; } };\n',
    },
  },
  "message-of-an-import-that-finds-nothing": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { ask } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), await ask());\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts":
        'const made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nexport const ask = () => import("./nothing-" + made).catch((e: any) => e.message);\n',
    },
  },
  "nobody-reads-anything": {
    held: [],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), value);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "nobody-reads-anything-beside-a-text": {
    held: [],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), value, new Function("a", "return a + " + process.argv.length)(1) > 0);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "own-dirname-of-a-commonjs-file": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport subject from "./seenFolder/seenSubject.cjs";\nconsole.log(quiet(1), subject.read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.cjs": "exports.read = __dirname;\n",
    },
  },
  "own-filename-of-a-commonjs-file": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport subject from "./seenFolder/seenSubject.cjs";\nconsole.log(quiet(1), subject.read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.cjs": "exports.read = __filename;\n",
    },
  },
  "own-import-meta-dir": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { read } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": "export const read = [import.meta.dir, import.meta.dirname].join();\n",
    },
  },
  "own-import-meta-file": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { read } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": "export const read = [import.meta.file, import.meta.filename].join();\n",
    },
  },
  "own-import-meta-let-go": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { read } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts":
        "export const read = JSON.stringify(((m: any) => Object.keys(m).sort().map(k => typeof m[k] === 'string' ? m[k] : k))(import.meta));\n",
    },
  },
  "own-import-meta-path": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { read } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": "export const read = import.meta.path;\n",
    },
  },
  "own-import-meta-url": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { read } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": "export const read = import.meta.url;\n",
    },
  },
  "own-module-id-filename-paths": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport subject from "./seenFolder/seenSubject.cjs";\nconsole.log(quiet(1), subject.read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.cjs":
        "exports.read = [module.id, module.filename, module.path, module.paths.length > 0].join();\n",
    },
  },
  "own-module-let-go": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport subject from "./seenFolder/seenSubject.cjs";\nconsole.log(quiet(1), subject.read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.cjs":
        "exports.read = JSON.stringify(((m) => Object.keys(m).sort().map(k => typeof m[k] === 'string' ? m[k] : k))(module));\n",
    },
  },
  "own-url-made-of-import-meta-url": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { read } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), read);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const read = new URL("./beside.txt", import.meta.url).href;\n',
    },
  },
  "resolve-by-bun-resolve-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = await Bun.resolve("./seenFolder/" + made, import.meta.dir); } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-bun-resolve-sync-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = Bun.resolveSync("./seenFolder/" + made, import.meta.dir); } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-create-require": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nimport { createRequire } from "node:module";\nconst own = createRequire(import.meta.url);\nlet found; try { found = own.resolve("./seenFolder/" + made) + " " + own("./seenFolder/" + made).value; } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-import-meta-resolve-of-a-constant": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), value, import.meta.resolve("./seenFolder/seenSubject"));\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-import-meta-resolve-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = import.meta.resolve("./seenFolder/" + made); } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-import-meta-resolve-sync-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = import.meta.resolveSync("./seenFolder/" + made); } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-module-resolve-filename": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nimport Module from "node:module";\nlet found; try { found = (Module as any)._resolveFilename("./seenFolder/" + made, { id: import.meta.path, filename: import.meta.path, paths: [] }); } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-require-resolve-of-a-constant": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconsole.log(quiet(1), value, require.resolve("./seenFolder/seenSubject"));\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-require-resolve-of-a-made-name": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nlet found; try { found = require.resolve("./seenFolder/" + made); } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "resolve-by-require-resolve-taken-as-a-value": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nconst resolve = require.resolve;\nlet found; try { found = resolve("./seenFolder/" + made); } catch (e: any) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "text-that-is-evaluated-requires-through-main-module": {
    held: ["seenFolder", "seenSubject", "quietFolder", "quietBystander"],
    files: {
      "main.cjs":
        'const { quiet } = require("./quietFolder/quietBystander");\nconst { value } = require("./seenFolder/seenSubject");\nlet found; try { found = (0, eval)("process.mainModule.require(\'./quietFolder/quietBystander\').quiet(4)"); } catch (e) { found = "threw " + e.message; }\nconsole.log(quiet(1), value, found);\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
    },
  },
  "worker-by-a-constant-path": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nconst worker = new Worker("./seenFolder/seenSubject.ts");\nconsole.log(quiet(1), await new Promise(resolve => { worker.onmessage = event => resolve(event.data); worker.onerror = event => resolve("error " + event.message); }));\nworker.terminate();\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'postMessage("worker says " + [import.meta.file].join());\n',
    },
  },
  "worker-by-a-made-path": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nconst made = Buffer.from("c2VlblN1YmplY3Q=", "base64").toString();\nconst worker = new Worker("./seenFolder/" + made + ".ts");\nconsole.log(quiet(1), await new Promise(resolve => { worker.onmessage = event => resolve(event.data); worker.onerror = event => resolve("error " + event.message); }));\nworker.terminate();\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'postMessage("worker says " + [import.meta.file].join());\n',
    },
  },
  "worker-by-a-url-of-import-meta-url": {
    held: ["seenFolder", "seenSubject"],
    files: {
      "main.ts":
        'import { quiet } from "./quietFolder/quietBystander";\nconst worker = new Worker(new URL("./seenFolder/seenSubject.ts", import.meta.url).href);\nconsole.log(quiet(1), await new Promise(resolve => { worker.onmessage = event => resolve(event.data); worker.onerror = event => resolve("error " + event.message); }));\nworker.terminate();\n',
      "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
      "seenFolder/seenSubject.ts": 'postMessage("worker says " + [import.meta.file].join());\n',
    },
  },
};

describe.concurrent("by each way to the path of a module an obfuscated executable answers as one that is not", () => {
  for (const [way, { held, files }] of Object.entries(ways)) {
    test(
      way,
      () =>
        slot(async () => {
          using dir = tempDir("aot-obfuscate-way", files);
          const both = await buildBoth(files, String(dir));
          expect({ ...both.obfuscated }).toMatchObject({
            stdout: both.reference.stdout,
            exitCode: both.reference.exitCode,
          });
          expect(both.reference.exitCode).toBe(0);
          expect(both.held).toEqual(held);
        }),
      buildLimit,
    );
  }
});

describe.concurrent("an obfuscated executable says nothing about its sources:", () => {
  // The run time shows the modules of the image as files of the folder of the executable. An obfuscated executable says nothing about its sources: it shows those whose paths it holds.
  // Whoever goes on to load what such a walk finds does so under a name that is made when the program runs, which keeps every path: load-by-*, above.
  test(
    "the file system shows of the image what the executable holds",
    () =>
      slot(async () => {
        const files = {
          "main.ts":
            'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nimport { readdirSync, existsSync } from "node:fs";\nlet walk; try { walk = readdirSync(import.meta.dir).sort().join(); } catch (e: any) { walk = "threw " + e.code; }\nconsole.log(quiet(1), value, Bun.embeddedFiles.length, walk, existsSync(import.meta.dir + "/quietFolder/quietBystander.ts"));\n',
          "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
          "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
        };
        using dir = tempDir("aot-obfuscate-walk", files);
        const both = await buildBoth(files, String(dir));
        expect(both.reference.stdout).toBe("2 subject 0 main.ts,quietFolder,seenFolder true\n");
        expect(both.obfuscated.stdout).toBe("2 subject 0 main.ts false\n");
      }),
    buildLimit,
  );

  // A text that is evaluated finds no file of the program, with --obfuscate or without. Without, the run time knows the path for that of a file of the image and says what to do about it.
  test(
    "a text that is evaluated is refused a file of the program in both, in other words",
    () =>
      slot(async () => {
        const files = {
          "main.ts":
            'import { quiet } from "./quietFolder/quietBystander";\nimport { value } from "./seenFolder/seenSubject";\nconst text = "return import(" + JSON.stringify(import.meta.dir + "/quietFolder/quietBystander.ts") + ").then(m => typeof m.quiet, e => \'threw \' + e.message)";\nconsole.log(quiet(1), value, await new Function(text)());\n',
          "quietFolder/quietBystander.ts": "export const quiet = (n: number) => n + 1;\n",
          "seenFolder/seenSubject.ts": 'export const value = "subject";\n',
        };
        using dir = tempDir("aot-obfuscate-text", files);
        const both = await buildBoth(files, String(dir));
        expect(both.reference.stdout).toStartWith("2 subject threw Cannot load ");
        expect(both.reference.stdout).toContain("this executable can't load a module from a dynamic path");
        expect(both.obfuscated.stdout).toStartWith("2 subject threw Cannot find module ");
      }),
    buildLimit,
  );
});
