import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// In an executable compiled code evaluates the modules: the start of a module is a row of calls, and the loader is asked only where something has to be waited for, linked or found out.
// Plain Bun says what is right: which bodies run, in which order, how often, and what becomes of one that throws.

const say = (text: string) => `console.log(${JSON.stringify(text)});`;

const programs: Record<string, Record<string, string>> = {
  "two ways lead to one module": {
    "main.ts": `import "./a"; import "./b"; ${say("main")}`,
    "a.ts": `import "./shared"; ${say("a")}`,
    "b.ts": `import "./shared"; ${say("b")}`,
    "shared.ts": say("shared"),
  },
  "modules that import each other": {
    "main.ts": `import { a } from "./a"; ${say("main")} console.log(a());`,
    "a.ts": `import { b } from "./b"; ${say("a")} export function a() { return "a sees " + b(); }`,
    "b.ts": `import { a } from "./a"; ${say("b")} console.log(typeof a); export function b() { return "b"; }`,
  },
  "a binding of a cycle is read before it is there": {
    "main.ts": `import "./a"; ${say("main")}`,
    "a.ts": `import "./b"; export const value = 1; ${say("a")}`,
    "b.ts": `import { value } from "./a"; try { console.log(value); } catch (error) { console.log((error as Error).name); }`,
  },
  "a module that awaits stands between two that do not": {
    "main.ts": `import "./first"; import "./waits"; import "./last"; ${say("main")}`,
    "first.ts": say("first"),
    "waits.ts": `import "./below"; ${say("waits begins")} await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 1)); ${say("waits ends")}`,
    "below.ts": say("below"),
    "last.ts": say("last"),
  },
  "a module that awaits in a cycle": {
    "main.ts": `import "./a"; ${say("main")}`,
    "a.ts": `import "./b"; ${say("a begins")} await 0; ${say("a ends")}`,
    "b.ts": `import "./a"; import "./c"; ${say("b")}`,
    "c.ts": say("c"),
  },
  "two modules await side by side": {
    "main.ts": `import "./a"; import "./b"; ${say("main")}`,
    "a.ts": `${say("a begins")} await new Promise(resolve => setTimeout(resolve, 5)); ${say("a ends")}`,
    "b.ts": `${say("b begins")} await 0; ${say("b ends")}`,
  },
  "a module that throws is asked for again by import()": {
    "main.ts": `
      const errors: unknown[] = [];
      for (let turn = 0; turn < 2; turn++) { try { await import("./bad"); } catch (error) { errors.push(error); } }
      console.log(errors.length, errors[0] === errors[1], (errors[0] as Error).message);
      try { await import("./above"); } catch (error) { console.log(error === errors[0]); }
    `,
    "bad.ts": `import "./good"; ${say("bad runs")} throw new Error("thrown at load");`,
    "good.ts": say("good runs"),
    "above.ts": `import "./good"; import "./bad"; ${say("never")}`,
  },
  "a module that throws under a statement ends the program": {
    "main.ts": `import "./first"; import "./bad"; import "./never"; ${say("main never")}`,
    "first.ts": say("first"),
    "bad.ts": `${say("bad")} process.exitCode = 7; throw new Error("thrown at load");`,
    "never.ts": say("never"),
  },
  "a CommonJS file that throws is required again": {
    "main.cjs": `
      globalThis.turns = 0;
      for (let turn = 0; turn < 3; turn++) { try { console.log(require("./bad.cjs")); } catch (error) { console.log(error.message); } }
    `,
    "bad.cjs": `const turn = ++globalThis.turns; console.log("bad runs", turn); if (turn < 3) throw new Error("thrown " + turn); module.exports = "done";`,
  },
  "CommonJS files require each other": {
    "main.cjs": `const a = require("./a.cjs"); console.log("main", a.name, a.seen);`,
    "a.cjs": `exports.name = "a"; const b = require("./b.cjs"); exports.seen = b.seen; console.log("a");`,
    "b.cjs": `const a = require("./a.cjs"); exports.seen = Object.keys(a).join(); console.log("b");`,
  },
  "an ES module imports a CommonJS file beside an ES module": {
    "main.mjs": `import "./one.mjs"; import two from "./two.cjs"; console.log("main", two);`,
    "one.mjs": say("one"),
    "two.cjs": `console.log("two"); module.exports = 2;`,
  },
  "a CommonJS file requires an ES module": {
    "main.cjs": `console.log("main begins"); const es = require("./es.mjs"); console.log(es.value, Object.keys(es).join()); console.log(require("./es.mjs") === es);`,
    "es.mjs": `import "./below.mjs"; console.log("es"); export const value = 1; export default 2;`,
    "below.mjs": say("below"),
  },
  "a function requires late what a statement has imported": {
    "main.ts": `import { value } from "./shared"; function late() { return require("./shared").value + require("./only-late").value; } console.log(value); console.log(late(), late());`,
    "shared.ts": `${say("shared")} export const value = 1;`,
    "only-late.ts": `import "./below-late"; ${say("only late")} export const value = 10;`,
    "below-late.ts": say("below late"),
  },
  "a require in a try around a file whose import throws": {
    "main.cjs": `
      try { require("./outer.cjs"); } catch (error) { console.log("caught", error.message); }
      try { require("./outer.cjs"); } catch (error) { console.log("caught again", error.message); }
      console.log(require("./inner-good.cjs"));
    `,
    "outer.cjs": `console.log("outer"); require("./inner-good.cjs"); require("./inner-bad.cjs"); console.log("never");`,
    "inner-good.cjs": `console.log("inner good"); module.exports = "good";`,
    "inner-bad.cjs": `console.log("inner bad"); throw new Error("inner");`,
  },
  "import() of what has run, of what has not, and twice at once": {
    "main.ts": `
      import "./ran";
      const [first, second] = await Promise.all([import("./fresh"), import("./fresh")]);
      console.log(first === second, first.value);
      console.log((await import("./ran")).value);
      async function again() { return (await import("./fresh")).value; }
      console.log(await again(), await again());
    `,
    "ran.ts": `${say("ran")} export const value = "ran";`,
    "fresh.ts": `import "./ran"; import "./below"; ${say("fresh")} export const value = "fresh";`,
    "below.ts": say("below"),
  },
  "a module with nothing to run stands between modules that run": {
    "main.ts": `import { make } from "./only-functions"; import "./last"; console.log(make());`,
    "only-functions.ts": `import "./below"; export function make() { return "made"; }`,
    "below.ts": say("below"),
    "last.ts": say("last"),
  },
  "barrels hand on what runs below them": {
    "main.ts": `import { a, b } from "./barrel"; console.log(a, b);`,
    "barrel.ts": `export * from "./a"; export * from "./b";`,
    "a.ts": `${say("a")} export const a = 1;`,
    "b.ts": `import "./a"; ${say("b")} export const b = 2;`,
  },
  "the namespace object of a module of the run time is this": {
    "main.ts": `
      import * as path from "node:path";
      import * as own from "./own";
      function twice() { return path.join("a", "b") + path.basename("/x/y.ts"); }
      console.log(twice(), twice(), own.self() === own, Object.keys(own).join());
    `,
    "own.ts": `export function self(this: unknown) { return this; } export const other = 1;`,
  },
  "jobs that a module queues run where plain Bun runs them": {
    "main.ts": `import "./a"; import "./b"; ${say("main")} queueMicrotask(() => ${say("job of main").slice(0, -1)});`,
    "a.ts": `${say("a")} queueMicrotask(() => ${say("job of a").slice(0, -1)}); process.nextTick(() => ${say("tick of a").slice(0, -1)});`,
    "b.ts": `${say("b")} Promise.resolve().then(() => ${say("job of b").slice(0, -1)});`,
  },
};

// A module that has begun and has not finished is not begun again, whoever asks: what it declares with `const`, `let` or `class` cannot be read yet, and what it declares
// with `function` can. Only a synchronous `require` gets to see that: what `import()` loads runs once the graph that is being evaluated has run.
const byName = (file: string) => `const name = "./" + (globalThis.never ? "x" : "") + ${JSON.stringify(file)};`;
const requires = (what: string) =>
  `console.log("d begins"); try { ${what}; } catch (error) { console.log("d caught", error.message); } console.log("d ends");`;
const m = `import "./d.mjs"; export const V = "v of m"; console.log("m");`;
const n = `import { V } from "./m.mjs"; console.log("n", V);`;
Object.assign(programs, {
  "what a module imports requires an importer of the module": {
    "m.mjs": m,
    "d.mjs": `${requires(`require("./n.mjs")`)} export {};`,
    "n.mjs": n,
  },
  "it requires the importer under a name made at run time": {
    "m.mjs": m,
    "d.mjs": `${byName("n.mjs")} ${requires("require(name)")} export {};`,
    "n.mjs": n,
  },
  "it requires the importer through createRequire": {
    "m.mjs": m,
    "d.mjs": `import { createRequire } from "node:module"; ${byName("n.mjs")} ${requires("createRequire(import.meta.url)(name)")}`,
    "n.mjs": n,
  },
  "it requires the module itself under a name made at run time": {
    "m.mjs": m,
    "d.mjs": `${byName("m.mjs")} ${requires(`console.log("d sees", require(name).V)`)} export {};`,
  },
  "the module is not the entry point": {
    "main.mjs": `import "./m.mjs"; console.log("main");`,
    "m.mjs": m,
    "d.mjs": `${byName("n.mjs")} ${requires("require(name)")} export {};`,
    "n.mjs": n,
  },
  "the importer reads a function and a variable of the module": {
    "m.mjs": `import "./d.mjs"; export function f() { return "f of m"; } export let W = "w of m"; console.log("m");`,
    "d.mjs": `${byName("n.mjs")} ${requires("require(name)")} export {};`,
    "n.mjs": `import { f, W } from "./m.mjs"; console.log("n", f()); try { console.log("n", W); } catch (error) { console.log("n caught", error.message); }`,
  },
  "the module imports more behind what requires": {
    "m.mjs": `import "./d.mjs"; import "./after.mjs"; export const V = "v of m"; console.log("m");`,
    "d.mjs": `${byName("n.mjs")} ${requires("require(name)")} export {};`,
    "after.mjs": `console.log("after");`,
    "n.mjs": n,
  },
  "the module reads what the requiring module exports": {
    "m.mjs": `import { D } from "./d.mjs"; export const V = "v of m"; console.log("m", D);`,
    "d.mjs": `${byName("n.mjs")} ${requires("require(name)")} export const D = "d of d";`,
    "n.mjs": n,
  },
  "two modules have begun": {
    "m.mjs": `import "./k.mjs"; export const V = "v of m"; console.log("m");`,
    "k.mjs": `import "./d.mjs"; export const K = "k of k"; console.log("k");`,
    "d.mjs": `${byName("n.mjs")} ${requires("require(name)")} export {};`,
    "n.mjs": `import { K } from "./k.mjs"; import { V } from "./m.mjs"; console.log("n", K, V);`,
  },
  "the importer is a CommonJS file": {
    "m.mjs": m,
    "d.mjs": `${byName("n.cjs")} ${requires("require(name)")} export {};`,
    "n.cjs": `console.log("n begins"); try { console.log("n", require("./m.mjs").V); } catch (error) { console.log("n caught", error.message); }`,
  },
  "the importer is loaded by import()": {
    "m.mjs": m,
    "d.mjs": `${byName("n.mjs")} console.log("d begins"); import(name).then(() => console.log("n is loaded"), error => console.log("d caught", error.message)); console.log("d ends"); export {};`,
    "n.mjs": n,
  },
  "what imports the module by import() awaits it": {
    "m.mjs": m,
    "d.mjs": `${byName("n.mjs")} console.log("d begins"); const late = new Promise(resolve => setTimeout(resolve, 200, "late")); console.log("d got", typeof (await Promise.race([import(name), late]))); console.log("d ends"); export {};`,
    "n.mjs": n,
  },
  "what requires has awaited": {
    "m.mjs": m,
    "d.mjs": `${byName("n.mjs")} console.log("d begins"); await 0; try { require(name); } catch (error) { console.log("d caught", error.message.slice(0, 22)); } console.log("d ends"); export {};`,
    "n.mjs": n,
  },
  // It runs while the graph is loaded, so the module has not begun: the `require` evaluates the module there and then, and the importer behind it.
  "what requires is a CommonJS file": {
    "m.mjs": `import "./d.cjs"; export const V = "v of m"; console.log("m");`,
    "d.cjs": `${byName("n.mjs")} ${requires("require(name)")}`,
    "n.mjs": n,
  },
});

// `bun run` has two loaders, and they do not read every file alike: cjs-order.test.ts. The one behind `import` never looks at the extension, so to it a file named
// `.mjs` that uses `require` and has no `import`, `export` or `await` of its own is CommonJS, and a file named `.cjs` that uses nothing of CommonJS is an ES module.
// Whichever loader comes first reads the file, and the other takes what it finds. A `require` that runs only once the file is loaded is never the first.
// Where a `require` stands beside the file, `bun run` wavers: which comes first hangs on the threads that read the texts. Nothing here asks that.
const mode = (file: string) =>
  `try { undeclared = 1; console.log("${file} is sloppy"); } catch { console.log("${file} is strict"); }`;
const above = `import "./d.mjs"; export const V = "v of m"; console.log("m");`;
Object.assign(programs, {
  "a file named .mjs with nothing but a require, which leads back above the file": {
    "main.mjs": `import "./m.mjs";`,
    "m.mjs": above,
    "d.mjs": `console.log("d begins"); require("./n.mjs"); console.log("d ends");`,
    "n.mjs": n,
  },
  "the same under a name made at run time": {
    "m.mjs": `import "./d.mjs"; export const V = 1; export function later() { return V; } console.log("m body ends");`,
    "d.mjs": `
      const name = process.argv.length > 90 ? "./x.mjs" : "./n.mjs";
      try {
        const n = require(name);
        console.log("required", Object.keys(n));
        try { console.log("g:", n.g()); } catch (e) { console.log("g throws", e.name, e.message); }
      } catch (e) { console.log("require throws", e.name, e.message); }
      console.log("d body ends");
    `,
    "n.mjs": `
      import { V, later } from "./m.mjs";
      export function g() { return V; }
      console.log("n body");
      try { console.log("later:", later()); } catch (e) { console.log("later throws", e.name, e.message); }
    `,
  },
  "the same named .mts": {
    "main.mjs": `import "./m.mts";`,
    "m.mts": `import "./d.mts"; export const V: string = "v of m"; console.log("m");`,
    "d.mts": `console.log("d begins"); require("./n.mts"); console.log("d ends");`,
    "n.mts": `import { V } from "./m.mts"; console.log("n", V);`,
  },
  "its importer reads what it exports": {
    "main.mjs": `import "./m.mjs";`,
    "m.mjs": `import d from "./d.mjs"; export const V = "v of m"; console.log("m", typeof d);`,
    "d.mjs": `console.log("d begins"); require("./n.mjs"); console.log("d ends");`,
    "n.mjs": n,
  },
  "the require stands in a function that runs later": {
    "main.mjs": `import "./m.mjs"; console.log("main"); globalThis.later();`,
    "m.mjs": above,
    "d.mjs": `${mode("d")} globalThis.later = () => { require("./n.mjs"); };`,
    "n.mjs": n,
  },
  "what it requires requires it": {
    "main.mjs": `import "./d.mjs"; console.log("main");`,
    "d.mjs": `${mode("d")} console.log("d begins"); require("./r.cjs"); console.log("d ends");`,
    "r.cjs": `console.log("r sees", typeof require("./d.mjs"), Object.keys(require("./d.mjs")).join());`,
  },
  "a file named .cjs with nothing of CommonJS above a module that is required": {
    "main.mjs": `import "./f.cjs"; console.log("main");`,
    "f.cjs": `${mode("f")} import("./r.mjs");`,
    "r.mjs": `console.log("r begins"); require("./n.mjs"); console.log("r ends"); export {};`,
    "n.mjs": `import "./f.cjs"; console.log("n");`,
  },
  "what it loads requires it": {
    "main.mjs": `import "./f.cjs"; console.log("main");`,
    "f.cjs": `${mode("f")} import("./r.cjs");`,
    "r.cjs": `console.log("r begins"); const f = require("./f.cjs"); console.log("r sees", typeof f, Object.prototype.toString.call(f));`,
  },
  "a file named .cjs in a package of ES modules is required while it runs": {
    "main.mjs": `import "./x.cjs"; console.log("main");`,
    "package.json": `{ "type": "module" }`,
    "x.cjs": `${mode("x")} console.log("x begins"); require("./r.cjs"); console.log("x ends");`,
    "r.cjs": `module.exports = 1; console.log("r begins"); const x = require("./x.cjs"); console.log("r sees", typeof x, Object.prototype.toString.call(x));`,
  },
  "it requires a module that imports it": {
    "main.mjs": `import "./x.cjs"; console.log("main");`,
    "package.json": `{ "type": "module" }`,
    "x.cjs": `${mode("x")} console.log("x begins"); require("./n.mjs"); console.log("x ends");`,
    "n.mjs": `import "./x.cjs"; console.log("n");`,
  },
  "a file named .mjs in a package of CommonJS": {
    "main.mjs": `import "./m.mjs";`,
    "package.json": `{ "type": "commonjs" }`,
    "m.mjs": above,
    "d.mjs": `${mode("d")} console.log("d begins"); import("./r.mjs"); console.log("d ends");`,
    "r.mjs": `require("./n.mjs"); export {};`,
    "n.mjs": n,
  },
});

// `bun run` writes `exports` for a `this` that belongs to the file, unless the file has an `import` or `export` statement. So the file is CommonJS to both loaders, whatever it is named.
// Beside such a statement `bun run` writes `null`, where the language and compiled code have undefined.
const thisOf = (file: string) => `console.log("${file}:", this == null ? "nothing" : typeof this); ${mode(file)}`;
Object.assign(programs, {
  "this in an entry point named .mjs": {
    "main.mjs": thisOf("main"),
  },
  "this in a file named .mjs that a statement imports": {
    "main.mjs": `import "./a.mjs"; import "./d.mjs"; console.log("main");`,
    "a.mjs": `console.log("a"); export {};`,
    "d.mjs": thisOf("d"),
  },
  "this in a file named .mts": {
    "main.mjs": `import "./a.mjs"; import "./d.mts"; console.log("main");`,
    "a.mjs": `console.log("a"); export {};`,
    "d.mts": `console.log("d:", typeof this);`,
  },
  "this in an arrow function of a file named .mjs": {
    "main.mjs": `import "./a.mjs"; import "./d.mjs"; console.log("main");`,
    "a.mjs": `console.log("a"); export {};`,
    "d.mjs": `const f = () => typeof this; console.log("d:", f());`,
  },
  "this in a file named .mjs that is required": {
    "main.mjs": `import "./c.cjs";`,
    "c.cjs": `const d = require("./d.mjs"); console.log("c sees", Object.prototype.toString.call(d));`,
    "d.mjs": thisOf("d"),
  },
  "this in a file named .mjs that import() loads": {
    "main.mjs": `const d = await import("./d.mjs"); console.log("main", Object.keys(d).join());`,
    "d.mjs": thisOf("d"),
  },
  "a file named .mjs hands this to its wrapper": {
    "main.mjs": `import d from "./d.mjs"; console.log("main", JSON.stringify(d));`,
    "d.mjs": `(function (root, factory) { factory(root); })(this, function (exports) { exports.made = true; });`,
  },
  "this beside an export is nothing": {
    "main.mjs": `import "./a.mjs"; import "./d.mjs"; console.log("main");`,
    "a.mjs": `console.log("a"); export {};`,
    "d.mjs": `${thisOf("d")} export {};`,
  },
});

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

for (const [name, files] of Object.entries(programs)) {
  test(name, async () => {
    using dir = tempDir("aot-modules-in-order", files);
    const folder = String(dir);
    const main = Object.keys(files)[0];
    const executable = join(folder, "compiled" + (isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", "./" + main, "--outfile", executable], folder);
    expect({
      errors: built.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: built.exitCode,
    }).toEqual({
      errors: [],
      exitCode: 0,
    });
    const [plain, compiled] = await Promise.all([
      run([bunExe(), "run", "./" + main], folder),
      run([executable], folder),
    ]);
    expect(plain.stdout).not.toBe("");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      exitCode: plain.exitCode,
    });
  });
}
