// `bun build --compile --aot --external left-out`: the name is left to the host, and a plugin that is laid at run time answers for it with the path of a file of the image.
// The build had read one name of that file and left the rest out: the importer got an empty object, in silence, or an export that is missing.
// A program that names the plugin and leaves a name to the host may name any of its files: each is whole, and each case is held against `bun main.mjs` in the same folder.
// Where the build does not see who lays the plugin, Bun.plugin() itself refuses aloud.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

type Files = Record<string, string>;

const whole: Record<string, Files> = {
  "the whole of a file of which the build has read one name": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import * as got from "left-out";
export function probe() {
  return typeof got.sum + " " + Object.keys(got).sort().join("+") + " " + typeof got.spare;
}
`,
  },
  "a name that nobody reads": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import { spare } from "left-out";
export function probe() {
  return spare("x");
}
`,
  },
  "a name that is read elsewhere, with other types": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import { sum as other } from "left-out";
export function probe() {
  return other("a", "b");
}
`,
  },
  "handed on by a star": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await import("./mid.mjs").then(it => Object.keys(it).sort().join("+") + " " + it.spare("z")); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`export * from "left-out";
`,
  },
  "by a call": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`export const probe = async () => { const got = await import("left-out"); return typeof got.sum + " " + Object.keys(got).sort().join("+"); };
`,
  },
  "required": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await import("./mid.cjs").then(it => it.probe()); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.cjs": String.raw`exports.probe = () => { const got = require("left-out"); return typeof got.sum + " " + Object.keys(got).sort().join("+"); };
`,
  },
  "a CommonJS file": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
import { used } from "./part.cjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total), used(1));
const target = import.meta.dir + "/" + JSON.parse('"part"') + ".cjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import * as got from "left-out";
export function probe() {
  return Object.keys(got).sort().join("+") + " " + got.unused("x");
}
`,
    "part.cjs": String.raw`exports.used = a => a + 1;
exports.unused = a => a + "!";
`,
  },
  "a class whose fields are proven": {
    "kind.ts": String.raw`export class Kind {
  size: number;
  constructor(size: number) { this.size = size; }
  grown(): number { return this.size + 1; }
}
export const make = (size: number) => new Kind(size);
`,
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
import { make } from "./kind.ts";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total), make(1).grown());
const target = import.meta.dir + "/" + JSON.parse('"kind"') + ".ts";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import * as got from "left-out";
export function probe() {
  return new got.Kind("a").grown() + " " + got.make("b").grown();
}
`,
  },
  "a file that has yet to run": {
    "late.mjs": String.raw`console.log("late runs");
export const one = 1;
export const two = 2;
`,
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"late"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun.plugin(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
console.log(String((await import("./uses-late.mjs")).first()));
`,
    "mid.mjs": String.raw`import * as got from "left-out";
export function probe() {
  return Object.keys(got).sort().join("+");
}
`,
    "uses-late.mjs": String.raw`import { one } from "./late.mjs";
export const first = () => one;
`,
  },
};

const refused: Record<string, Files> = {
  "by a computed key": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
Bun[JSON.parse('"plugin"')](answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import * as got from "left-out";
export function probe() {
  return typeof got.sum + " " + Object.keys(got).sort().join("+") + " " + typeof got.spare;
}
`,
  },
  "by a text that is evaluated": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
(0, eval)("Bun.plugin")(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import * as got from "left-out";
export function probe() {
  return typeof got.sum + " " + Object.keys(got).sort().join("+") + " " + typeof got.spare;
}
`,
  },
  "by the code of a package that is left out": {
    "lib.mjs": String.raw`export function sum(a, b) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? a + b : 0;
}
function twice(a) { return a + a; }
export function spare(a) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work === 1 ? twice(a) : 0;
}
export default "the default";
`,
    "main.mjs": String.raw`import { lay } from "lays";
import { sum } from "./lib.mjs";
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + 1) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
const answer = { name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } };
lay(answer);
let out = "asked";
try { out = await (await import("./mid.mjs")).probe(); } catch (e) { out += "|" + e.name + ":" + String(e.message).replace(/'[^']*'/g, "'..'").slice(0, 60); }
console.log(String(out));
`,
    "mid.mjs": String.raw`import * as got from "left-out";
export function probe() {
  return typeof got.sum + " " + Object.keys(got).sort().join("+") + " " + typeof got.spare;
}
`,
    "node_modules/lays/index.js": String.raw`export const lay = answer => Bun.plugin(answer);
`,
    "node_modules/lays/package.json": String.raw`{ "name": "lays", "version": "1.0.0", "main": "index.js", "type": "module" }
`,
  },
};

async function answersOf(files: Files) {
  using dir = tempDir("aot-a-name-left-to-the-host-is-answered-with-a-file-of-the-image", files);
  const directory = String(dir);
  const executable = join(directory, isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
  const leftOut = ["--external", "left-out", "--external", "lays"];
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", ...leftOut, "main.mjs", "--outfile", executable],
    directory,
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], directory, bunEnv);
  return { plain, compiled };
}

describe("the program names the plugin: the file is whole", () => {
  test.each(Object.keys(whole))("%s", async name => {
    const { plain, compiled } = await answersOf(whole[name]);
    expect(plain.stdout).not.toContain("asked|");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      exitCode: plain.exitCode,
    });
  });
});

describe("the build does not see who lays the plugin: the plugin is refused aloud", () => {
  test.each(Object.keys(refused))("%s", async name => {
    const { plain, compiled } = await answersOf(refused[name]);
    expect(plain.stdout).not.toContain("asked|");
    expect(compiled.stdout.trim().split("\n")).toEqual([plain.stdout.split("\n")[0]]);
    expect(compiled.stderr).toContain("Cannot use Bun.plugin: no file that was compiled names it");
    expect(compiled.exitCode).toBe(1);
  });
});
