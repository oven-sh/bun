// `var app = exports = module.exports = {}` (an old idiom of CommonJS packages) and `module.exports = exports = f` (what TypeScript emits) leave the names `exports` and `module.exports` with one value,
// as `exports = module.exports = f;` does. A file with either is lowered like any other CommonJS file. What a program can see must stay what plain Bun shows: what `require` answers, that a later
// `exports.name = ..` lands on the new value, what the first exports object still is for whoever took it before, and the files in which the store stands where it may not run.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files: Record<string, string> = {
  "declared.cjs": `var first = exports;
var kit = exports = module.exports = {};
kit.weigh = function weigh(parcel, scale) { return parcel.grams * scale.factor; };
exports.label = function label(parcel) { return parcel.name + ":" + this.weigh(parcel, { factor: 2 }); };
kit.same = [kit === exports, kit === module.exports, first === exports, Object.keys(first).length];`,
  "declared-const.cjs": `const kit = exports = module.exports = { size: 1 };
exports.grown = kit.size + 1;`,
  "inside.cjs": `function Scale(factor) { this.factor = factor; }
module.exports = exports = Scale;
exports.unit = new Scale(1);
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Scale;`,
  "inside-declared.cjs": `var kit = module.exports = exports = { size: 3 };
exports.grown = kit.size + 1;
kit.same = kit === module.exports && kit === exports;`,
  "twice.cjs": `var kit = exports = module.exports = { turn: 1 };
exports = module.exports = { turn: 2, before: kit.turn };
exports.after = true;`,
  "under-a-condition.cjs": `if (process.argv.length > 99) var kit = exports = module.exports = { never: true };
exports.kept = typeof kit;`,
  "in-a-function.cjs": `function later() { var kit = exports = module.exports = { late: true }; return kit; }
exports.early = true;
var first = exports;
first.made = later().late;
exports.afterwards = true;`,
  "alone.cjs": `var kit = exports = { lost: true };
exports.alsoLost = true;
module.exports.kept = Object.keys(kit).join();`,
  "handed-on.cjs": `function take(value) { return Object.keys(value).length; }
var count = take(exports = module.exports = { one: 1, two: 2 });
exports.count = count;`,
  "main.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
function Parcel(name, grams) { this.name = name; this.grams = grams; }
const show = value => JSON.stringify(value, (key, held) => (typeof held === "function" ? "function " + held.name : held));
const declared = require("./declared.cjs");
console.log("declared", declared.label(new Parcel("tea", 40)), show(declared));
console.log("declared-const", show(require("./declared-const.cjs")));
const Scale = require("./inside.cjs");
console.log("inside", typeof Scale, Scale.unit.factor, Scale.default === Scale, Scale.__esModule, new Scale(5).factor);
for (const name of ["inside-declared", "twice", "under-a-condition", "in-a-function", "alone", "handed-on"]) console.log(name, show(require("./" + name + ".cjs")));
`,
};

test("a store to exports beside module.exports, in a declaration or on the inside, shows what plain Bun shows", async () => {
  using dir = tempDir("aot-store-to-exports-beside-module-exports", files);
  const cwd = String(dir);
  const plain = await run([bunExe(), "main.mjs"], cwd, bunEnv);
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain(
    `declared tea:80 {"weigh":"function weigh","label":"function label","same":[true,true,false,0]}`,
  );
  const executable = join(cwd, "program");
  expect(
    (await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], cwd, bunEnv)).exitCode,
  ).toBe(0);
  const compiled = await run([executable], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 240_000);
