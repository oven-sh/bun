// Programs of several files. The main file asks a loader for another file by a name that it puts together at run time. The other file is an entry
// point of the same build, so the executable holds it. A program is one kind of file to load (it awaits nothing at its top level, awaits once,
// often or a timer, throws, rejects, imports a file that awaits, loads a file itself, walks an async generator, is CommonJS, is TypeScript), one
// loader (require, module.require, createRequire, import.meta.require) and one moment of the call.
import type { Random } from "./random";

const loaded = {
  "awaits-once": {
    file: "_settled.mjs",
    text: `console.log("settled begins"); const v = await Promise.resolve(1); console.log("settled after", v); export const value = v + 1; export default "default of settled";`,
  },
  "awaits-nothing": {
    file: "_none.mjs",
    text: `console.log("none runs"); export const value = 10; export function f(a) { return a + value; }`,
  },
  "awaits-often": {
    file: "_many.mjs",
    text: `console.log("many begins"); let t = 0; for (let i = 0; i < 5; i++) t += await Promise.resolve(i); t += await 5; await null; t += await { then(ok) { console.log("then read"); ok(3); } }; console.log("many ends", t); export const value = t;`,
  },
  "awaits-a-timer": {
    file: "_pending.mjs",
    text: `console.log("pending begins"); await new Promise(r => setTimeout(r, 1)); console.log("pending ends"); export const value = "late";`,
  },
  "throws": {
    file: "_throws.mjs",
    text: `console.log("throws begins"); export let value = "early"; await null; throw new Error("from the module");`,
  },
  "rejects": {
    file: "_rejects.mjs",
    text: `console.log("rejects begins"); export let value = "early"; await Promise.reject(new RangeError("rejected")); value = "never";`,
  },
  "imports-a-file-that-awaits": {
    file: "_chain.mjs",
    text: `import { value as inner } from "./_settled.mjs"; console.log("chain begins", inner); export const value = await Promise.resolve(inner * 2); console.log("chain ends");`,
  },
  "loads-a-file-itself": {
    file: "_asksback.mjs",
    text: `import { createRequire } from "node:module"; const r = createRequire(import.meta.url); console.log("asksback begins"); const name = ["./_sett", "led.mjs"].join(""); export const inner = r(name).value; await null; export const value = "after " + inner; console.log("asksback ends");`,
  },
  "walks-an-async-generator": {
    file: "_forawait.mjs",
    text: `async function* g() { yield 1; yield 2; yield 3; } console.log("forawait begins"); let t = 0; for await (const x of g()) t += x; const last = await g().next(); console.log("forawait ends", t, JSON.stringify(last)); export const value = t; export const kept = last;`,
  },
  "is-commonjs": {
    file: "_common.cjs",
    text: `console.log("common runs"); exports.value = "cjs"; Promise.resolve().then(() => console.log("job of common"));`,
  },
  "is-typescript": {
    file: "_typed.ts",
    text: `export enum Color { Red = 1, Green } export type T = { a: number }; console.log("typed begins"); const t: T = await Promise.resolve({ a: Color.Green }); export const value: number = t.a + 1; console.log("typed ends");`,
  },
};

const loaders = {
  "require": ["cjs", `const load = (n) => require(n);`],
  "module.require": ["cjs", `const load = (n) => module.require(n);`],
  "createRequire-in-commonjs": ["cjs", `const load = require("module").createRequire(__filename);`],
  "createRequire-in-a-module": [
    "mjs",
    `import { createRequire } from "node:module"; const load = createRequire(import.meta.url);`,
  ],
  "import.meta.require": ["mjs", `const load = (n) => import.meta.require(n);`],
  "import.meta.require-in-typescript": ["ts", `const load = (n: string): any => import.meta.require(n);`],
} as const;

const moments = {
  "once": `Promise.resolve().then(() => console.log("job before")); attempt("first", () => load(name)); console.log("behind the call"); await null; console.log("a turn later");`,
  "twice-and-later": `const a = attempt("first", () => load(name)); const b = attempt("second", () => load(name)); console.log(a === b); await new Promise(r => setTimeout(r, 5)); const c = attempt("third", () => load(name)); console.log(a === c);`,
  "after-an-import": `let ns; try { ns = await import(name); show("imported", ns); } catch (e) { console.log("import rejected", e.constructor.name); } const a = attempt("required", () => load(name)); console.log(a === ns, a && ns && a.value === ns.value);`,
  "while-an-import-is-under-way": `const p = import(name).then(ns => { show("imported", ns); return ns; }, e => console.log("import rejected", e.constructor.name)); const a = attempt("required", () => load(name)); const ns = await p; console.log(a === ns, Boolean(a && ns && a.value === ns.value));`,
  "in-a-job-and-a-timer": `await new Promise(done => queueMicrotask(() => { attempt("in a job", () => load(name)); done(); })); await new Promise(done => setTimeout(() => { attempt("in a timer", () => load(name)); done(); }, 2));`,
  "among-built-in-modules": `for (const n of ["fs", name, "node:path", name]) attempt(n === name ? "own" : n, () => load(n).value === undefined ? { value: "built in" } : load(n)); await null;`,
};

const helpers = `function show(label, m) { try { console.log(label, typeof m, Object.keys(m).sort().join(), String(m.value), m.default === undefined ? "no default" : typeof m.default); } catch (e) { console.log(label, "cannot show", e.constructor.name); } }
function attempt(label, f) { try { const m = f(); show(label, m); return m; } catch (e) { console.log(label, "threw", e && e.constructor && e.constructor.name, String(e && e.message).replace(/["'\`\\/][^ ]*/g, "<p>").slice(0, 70)); } }`;

const withTypes = (text: string) =>
  text
    .replace("show(label, m)", "show(label: string, m: any)")
    .replace("attempt(label, f)", "attempt(label: string, f: () => any)")
    .replace(/catch \(e\)/g, "catch (e: any)")
    .replace("let ns;", "let ns: any;")
    .replace(/e => console/g, "(e: any) => console")
    .replace(/done =>/g, "(done: any) =>")
    .replace(/ns => \{/g, "(ns: any) => {");

export type ProgramOfSeveralFiles = {
  name: string;
  file: string;
  text: string;
  files: Record<string, string>;
  entryPoints: string[];
};

function write(
  kind: keyof typeof loaded,
  loader: keyof typeof loaders,
  moment: keyof typeof moments,
): ProgramOfSeveralFiles {
  const [extension, load] = loaders[loader];
  const typed = extension === "ts" ? withTypes : (text: string) => text;
  const { file } = loaded[kind];
  return {
    name: `${kind} ${loader} ${moment}`,
    file: `main.${extension}`,
    text: `${load}
${typed(helpers)}
const name = ["./", ${JSON.stringify(file.slice(0, 3))}, ${JSON.stringify(file.slice(3))}].join("");
(async () => {
  ${typed(moments[moment])}
  await new Promise(r => setTimeout(r, 10));
  console.log("the end");
})();
`,
    files: Object.fromEntries(Object.values(loaded).map(({ file, text }) => [file, text + "\n"])),
    entryPoints: kind === "loads-a-file-itself" ? [file, loaded["awaits-once"].file] : [file],
  };
}

const keysOf = <T extends object>(table: T) => Object.keys(table) as (keyof T)[];

/** Every kind of file, by every loader, at every moment. */
export const everyProgram = (): ProgramOfSeveralFiles[] =>
  keysOf(loaded).flatMap(kind =>
    keysOf(loaders).flatMap(loader => keysOf(moments).map(moment => write(kind, loader, moment))),
  );

export const generate = (random: Random): ProgramOfSeveralFiles =>
  write(random.pick(keysOf(loaded)), random.pick(keysOf(loaders)), random.pick(keysOf(moments)));
