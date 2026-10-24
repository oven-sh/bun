import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "../run-programs";

type Case = { flags: string[]; files: Record<string, string>; env?: Record<string, string> };

const cases: Record<string, Case> = {
  "define: a string picks the arm": {
    flags: ['--define=process.env.NODE_ENV="production"'],
    files: {
      "main.js": `if (process.env.NODE_ENV === "production") require("./prod"); else require("./missing-dev");
console.log(process.env.NODE_ENV !== "production" ? require("./missing-dev-2") : "prod arm");
console.log(process.env.NODE_ENV, typeof process.env.NODE_ENV);`,
      "prod.js": `console.log("load prod");`,
    },
  },
  "define: boolean, number, null, undefined": {
    flags: ["--define=FLAG=false", "--define=LEVEL=3", "--define=NOTHING=null", "--define=ABSENT=undefined"],
    files: {
      "main.js": `FLAG && require("./missing-1");
LEVEL > 2 || require("./missing-2");
NOTHING ?? console.log("nullish");
ABSENT ?? console.log("nullish too");
LEVEL ?? require("./missing-3");
console.log(FLAG, LEVEL + 1, NOTHING, ABSENT, typeof FLAG, typeof LEVEL, typeof NOTHING, typeof ABSENT);`,
    },
  },
  "define: an object is fresh at each use": {
    flags: ['--define=CONFIG={"a":[1,2],"b":{"c":null}}'],
    files: {
      "main.js": `console.log(JSON.stringify(CONFIG), CONFIG.a.length, CONFIG === CONFIG, CONFIG.a === CONFIG.a);
CONFIG.a.push(3);
console.log(CONFIG.a.length);`,
    },
  },
  "define: a path of globals": {
    flags: ["--define=LOG=console.log"],
    files: {
      "main.js": `LOG("through the define");
console.log(typeof LOG);`,
    },
  },
  "define: a declared name is not replaced": {
    flags: ["--define=FLAG=false"],
    files: {
      "main.js": `function f(FLAG) {
  return FLAG ? "parameter" : "never";
}
console.log(f(true));
{
  const FLAG = 1;
  console.log(FLAG);
}
console.log(FLAG);
if (FLAG) require("./missing");`,
    },
  },
  "define: brackets are members": {
    flags: ['--define=process.env.NODE_ENV="production"'],
    files: {
      "main.js": `console.log(process["env"]["NODE_ENV"], process.env["NODE_ENV"], process.env[\`NODE_ENV\`]);
if (process["env"].NODE_ENV !== "production") require("./missing");`,
    },
  },
  "define: not through ?., not a target": {
    flags: ['--define=process.env.NODE_ENV="production"'],
    env: { NODE_ENV: "from-env" },
    files: {
      "main.js": `console.log(process?.env.NODE_ENV, process.env?.NODE_ENV);
process.env.NODE_ENV = "assigned";
const key = "NODE_ENV";
console.log(process.env[key], process.env.NODE_ENV);`,
    },
  },
  "define: the longest path wins": {
    flags: ['--define=process.env.NODE_ENV="production"', '--define=process.env={"OTHER":"o"}'],
    files: {
      "main.js": `console.log(process.env.NODE_ENV, process.env.OTHER, JSON.stringify(process.env));`,
    },
  },
  "define: import.meta": {
    flags: ['--define=import.meta.env.MODE="test"'],
    files: {
      "main.mjs": `console.log(import.meta.env.MODE);
if (import.meta.env.MODE !== "test") await import("./missing");`,
    },
  },
  "define: in a with statement the name is looked up": {
    flags: ["--define=FLAG=false"],
    files: {
      "main.cjs": `with ({ FLAG: "from the object" }) {
  console.log(FLAG);
}
console.log(FLAG);`,
    },
  },
  "define: a direct eval inside a with statement": {
    flags: ["--define=FLAG=false"],
    files: {
      "main.cjs": `with ({ FLAG: "from the object" }) {
  (function (text) {
    eval(text);
    console.log(FLAG);
  })("");
}`,
    },
  },
  "define: after a direct eval": {
    flags: ["--define=FLAG=false", '--define=process.env.NODE_ENV="production"'],
    files: {
      "main.cjs": `function f(text) {
  eval(text);
  return FLAG ? "never" : process.env.NODE_ENV;
}
console.log(f(""));
eval("");
console.log(FLAG, process.env.NODE_ENV, typeof require);`,
    },
  },
  "define: delete of a defined path": {
    flags: ['--define=process.env.NODE_ENV="production"', "--define=process.env.ALIAS=holder.member"],
    env: { NODE_ENV: "from-env", ALIAS: "from-env" },
    files: {
      "main.js": `globalThis.holder = { member: 1 };
console.log(delete process.env.NODE_ENV, "NODE_ENV" in process.env);
console.log(delete process.env.ALIAS, "ALIAS" in process.env, "member" in holder);`,
    },
  },
  "define: a renamed target names a function": {
    flags: ["--define=OLD=renamed", "--define=MEMBER=holder.member"],
    files: {
      "main.js": `globalThis.renamed = undefined;
globalThis.holder = {};
OLD = function () {};
MEMBER = function () {};
console.log(renamed.name, JSON.stringify(holder.member.name));
[OLD = () => {}, MEMBER = () => {}] = [];
console.log(renamed.name, JSON.stringify(holder.member.name));`,
    },
  },
  "define: delete of a defined name": {
    flags: ["--define=FLAG=false"],
    files: {
      "main.cjs": `globalThis.FLAG = "global";
console.log(delete FLAG, "FLAG" in globalThis);`,
    },
  },
  "feature: on and off": {
    flags: ["--feature=ON"],
    files: {
      "main.ts": `import { feature } from "bun:bundle";
if (feature("ON")) require("./on"); else require("./missing-1");
if (feature("OFF")) require("./missing-2");
console.log(feature("ON") ? "on" : "off", feature("OFF") ? "on" : "off");
if (!feature("OFF") && feature("ON")) console.log("both");
if (feature("OFF") || feature("ON")) console.log("either");
if ({ on: feature("ON") }.on) console.log("in an object literal");`,
      "on.ts": `console.log("load on");`,
    },
  },
  "feature: under another name": {
    flags: ["--feature=ON"],
    files: {
      "main.ts": `import { feature as flag } from "bun:bundle";
console.log(flag("ON") ? "on" : "off", flag("OFF") ? "on" : "off");`,
    },
  },
  "feature: a parameter of that name is called": {
    flags: ["--feature=ON"],
    files: {
      "main.ts": `import { feature } from "bun:bundle";
function f(feature: (name: string) => boolean) {
  return feature("ON") ? "never" : "called";
}
console.log(f(() => false), feature("ON") ? "on" : "off");`,
    },
  },
  "feature: in a function inside a test": {
    flags: ["--feature=ON"],
    files: {
      "main.ts": `import { feature } from "bun:bundle";
if ((() => feature("ON"))()) console.log("arrow function");
if ((function () { return feature("ON"); })()) console.log("function expression");
if (((on = feature("ON")) => on)()) console.log("parameter default");
if ((({ on = feature("ON") }: { on?: boolean }) => on)({})) console.log("pattern default");
if ((() => { const on = feature("ON"); return on; })()) console.log("variable");
if (new (class { on = feature("ON"); })().on) console.log("class field");
console.log((() => feature("OFF"))() ? "on" : "off");
console.log((() => (feature("OFF") ? "never" : feature("ON")))() ? "arm of an inner test" : "off");`,
    },
  },
  "drop: console": {
    flags: ["--drop=console"],
    files: {
      "main.ts": `let evaluated = 0;
const say = (text: unknown) => void process.stdout.write(String(text) + "\\n");
console.log("dropped", evaluated++);
console.error.call(console, evaluated++);
console?.warn(evaluated++);
(console as any).info(evaluated++);
say(console.log("its value", evaluated++));
say(evaluated);
function shadows(console: { log(text: string): string }) { return console.log("a parameter by the name is called"); }
say(shadows({ log: text => text }));
{ const console = { log: (text: string) => "so is a constant: " + text }; say(console.log("called")); }
say(typeof console.log);
const held = console;
held.table = () => say("through another name it is called");
held.table();
say((console as any).log("as a test") ? "never" : "the arm for undefined");
import("./other").then(other => other.run());`,
      "other.ts": `export function run() { console.log("dropped in every file"); process.stdout.write("other ran\\n"); }`,
    },
  },
  "drop: a function and a path": {
    flags: ["--drop=assert", "--drop=tools.trace"],
    files: {
      "main.ts": `declare function assert(ok: boolean): void;
declare namespace assert { function equal(a: unknown, b: unknown): void; }
declare const tools: { trace: { (text: string): void; deep(text: string): void }; keep(text: string): string };
(globalThis as any).tools = { trace: () => { throw new Error("tools.trace was called"); }, keep: (text: string) => text };
let evaluated = 0;
assert(evaluated++ > 5);
assert.equal(evaluated++, 7);
tools.trace("dropped");
tools.trace.deep("dropped");
tools.trace?.deep("dropped");
try {
  tools?.trace("called: ?. is inside the dropped path");
} catch (e) {
  console.log((e as Error).message, evaluated);
}
console.log(evaluated, tools.keep("kept"));`,
    },
  },
  "drop: after a direct eval": {
    flags: ["--drop=assert"],
    files: {
      "main.cjs": `let evaluated = 0;
function f(text) {
  eval(text);
  assert(evaluated++);
}
f("");
console.log(evaluated);`,
    },
  },
  "drop: debugger": {
    flags: ["--drop=debugger"],
    files: {
      "main.js": `debugger;
if (process.argv.length > 100) debugger;
else console.log("the other arm");
console.log("ran");`,
    },
  },
  "dead operands": {
    flags: [],
    files: {
      "main.js": `false && require("./missing-1");
true || require("./missing-2");
0 ?? require("./missing-3");
console.log(1 ? "yes" : require("./missing-4"));
if (!1) require("./missing-5");
if ("") require.resolve("./missing-6");
if (typeof 1 === "string") require("./missing-7");
if (1 + 1 === 3) require("./missing-8");
console.log("ran");`,
    },
  },
  "dead import()": {
    flags: [],
    files: {
      "main.mjs": `if (false) await import("./missing");
console.log("ran");
const a = await import("./a");
console.log(Object.keys(a).length);`,
      "a.mjs": `console.log("load a");`,
    },
  },
  "a specifier that is computed from constants": {
    flags: [],
    files: {
      "main.js": `require("./" + "a");
require(\`./\${"b"}\`);
const part = "c";
require("./" + part);`,
      "a.js": `console.log("load a");`,
      "b.js": `console.log("load b");`,
      "c.js": `console.log("load c");`,
    },
  },
  "a constant specifier whose argument is still evaluated": {
    flags: [],
    files: {
      "main.js": `const part = "a";
function name() { return part; }
require("./" + part);
const whole = "./b";
function load() { return require(whole); }
load();
let n = 0;
require((n++, "./c"));
console.log(name(), n);
try {
  loadLate();
} catch (e) {
  console.log(e.name);
}
const late = "./d";
function loadLate() { return require(late); }
loadLate();`,
      "a.js": `console.log("load a");`,
      "b.js": `console.log("load b");`,
      "c.js": `console.log("load c");`,
      "d.js": `console.log("load d");`,
    },
  },
  "require in a file with a direct eval": {
    flags: [],
    files: {
      "main.cjs": `const hidden = eval("require");
const lib = require("./lib.cjs");
function load(text) {
  eval(text);
  return require("./other.cjs");
}
console.log(typeof hidden, lib.name, load("").name);`,
      "lib.cjs": `exports.name = "lib";`,
      "other.cjs": `exports.name = "other";`,
    },
  },
  "dead code still declares": {
    flags: [],
    files: {
      "main.cjs": `if (false) {
  var v = 1;
  function g() {}
}
console.log(typeof v, typeof g);`,
    },
  },
  "a read in the dead zone still throws": {
    flags: [],
    files: {
      "main.js": `try {
  if (K) console.log("yes");
  else require("./missing");
} catch (e) {
  console.log(e.name);
}
const K = 1;`,
    },
  },
  "an operand with effects still runs": {
    flags: [],
    files: {
      "main.js": `let n = 0;
const bump = () => ++n;
if ((bump(), false)) require("./missing");
(bump(), true) || require("./missing-2");
console.log(n);`,
    },
  },
  "TypeScript: an unused import is no import": {
    flags: [],
    files: {
      "main.ts": `import { T } from "./types";
import { used } from "./used";
const x: T = used;
console.log(x);`,
      "types.ts": `console.log("load types");
export type T = number;`,
      "used.ts": `console.log("load used");
export const used = 1;`,
    },
  },
  "TypeScript: an import used only in dead code is still loaded": {
    flags: [],
    files: {
      "main.ts": `import { a } from "./a";
if (false) a();
console.log("main");`,
      "a.ts": `console.log("load a");
export function a() {}`,
    },
  },
  "TypeScript: an unused import-equals require is still loaded": {
    flags: [],
    files: {
      "main.ts": `import unused = require("./lib");
console.log("main");`,
      "lib.ts": `console.log("load lib");
export = 1;`,
    },
  },
  "TypeScript: an import read only through an alias": {
    flags: [],
    files: {
      "main.ts": `import * as ns from "./m";
import inner = ns.inner;
import f = inner.f;
namespace Local {
  import g = ns.g;
  export const value = g();
}
console.log(f(1), Local.value);`,
      "m.ts": `console.log("load m");
export namespace inner {
  export function f(x: number) { return x + 1; }
}
export function g() { return "g"; }`,
    },
  },
  "TypeScript: an import named only by an unused alias is still loaded": {
    flags: [],
    files: {
      "main.ts": `import * as ns from "./m";
import unused = ns.f;
console.log("main");`,
      "m.ts": `console.log("load m");
export function f() {}`,
    },
  },
  "JavaScript: an unused import is loaded": {
    flags: [],
    files: {
      "main.mjs": `import { a } from "./a";
console.log("main");`,
      "a.mjs": `console.log("load a");
export const a = 1;`,
    },
  },
  "an import for its effects": {
    flags: [],
    files: {
      "main.ts": `import "./a";
console.log("main");`,
      "a.ts": `console.log("load a");`,
    },
  },
  "format: module and exports in dead code do not count": {
    flags: [],
    files: {
      "main.js": `if (false) {
  module.exports = 1;
  exports.a = 1;
}
console.log(this === undefined);`,
    },
  },
  "format: a use strict directive alone is CommonJS": {
    flags: [],
    files: {
      "main.js": `"use strict";
console.log(this === undefined, typeof module);`,
    },
  },
  "format: require alone is CommonJS": {
    flags: [],
    files: {
      "main.js": `require("./a");
console.log(this === undefined);`,
      "a.js": `console.log("load a");`,
    },
  },
  "format: require with an import is a module": {
    flags: [],
    files: {
      "main.js": `import "./a";
require("./b");
console.log((function () { return this === undefined; })());`,
      "a.js": `console.log("load a");`,
      "b.js": `console.log("load b");`,
    },
  },
  "format: require with an unused TypeScript import is a module": {
    flags: [],
    files: {
      "main.ts": `import { T } from "./types";
require("./a");
const x: T = 1;
console.log(x, (function (this: unknown) { return this === undefined; })());`,
      "types.ts": `console.log("load types");
export type T = number;`,
      "a.ts": `console.log("load a");`,
    },
  },
  "format: require with a type-only import clause is CommonJS": {
    flags: [],
    files: {
      "main.ts": `import { type T } from "./types";
require("./a");
const x: T = 1;
console.log(x, (function (this: unknown) { return this === undefined; })());`,
      "types.ts": `console.log("load types");
export type T = number;`,
      "a.ts": `console.log("load a");`,
    },
  },
  "import.meta.main": {
    flags: [],
    files: {
      "main.mjs": `console.log(import.meta.main);
if (!import.meta.main) await import("./missing");
const other = await import("./other");
console.log(other.isMain);`,
      "other.mjs": `console.log("load other");
export const isMain = import.meta.main;`,
    },
  },
  "a macro's result": {
    flags: [],
    files: {
      "main.ts": `import { pair } from "./macro" with { type: "macro" };
const one = pair(1 + 2, "a" + "b");
console.log(JSON.stringify(one), pair(1, "x") === pair(1, "x"));`,
      "macro.ts": `export function pair(n: number, s: string) {
  return { n, list: [s, s] };
}`,
    },
  },
};

function matchesRow(kind: string, value: string, got: unknown): boolean {
  switch (kind) {
    case "undefined":
      return got === undefined;
    case "null":
      return got === null;
    case "boolean":
      return got === (value === "true");
    case "number":
      return typeof got === "number" && Object.is(got, value === "-0" ? -0 : Number(value));
    case "string":
      return got === value;
    case "bigint":
      return typeof got === "bigint" && String(got) === value;
    default:
      return false;
  }
}

describe("constant-expressions.txt", () => {
  test("every value is what Bun computes", () => {
    const lines = readFileSync(join(import.meta.dir, "constant-expressions.txt"), "utf8").split("\n");
    const wrong: string[] = [];
    let rows = 0;
    lines.forEach((line, index) => {
      if (line === "" || line.startsWith("#")) return;
      const [kind, value, ...rest] = line.split("\t");
      if (kind === "unknown") return;
      const expression = rest.join("\t");
      rows++;
      if (!matchesRow(kind, value, (0, eval)("(" + expression + ")"))) wrong.push(`${index + 1}: ${expression}`);
    });
    expect(wrong).toEqual([]);
    expect(rows).toBeGreaterThan(200);
  });
});

describe.concurrent("compile/aot/fold matches the transpiler", () => {
  if (unsupported) return void test.skip(unsupported, () => {});
  for (const [name, { flags, files, env: caseEnv }] of Object.entries(cases)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-fold", files);
          const folder = String(dir);
          const main = Object.keys(files).find(file => file.startsWith("main."))!;
          const env = { ...bunEnv, ...caseEnv };
          const executable = join(folder, "program" + (isWindows ? ".exe" : ""));

          const plain = await spawned([bunExe(), "run", ...flags, main], folder, env);
          expect({
            signal: plain.signal,
            exitCode: plain.exitCode,
            stderr: plain.exitCode ? plain.stderr : "",
          }).toEqual({ signal: null, exitCode: 0, stderr: "" });

          built(
            await spawned(
              [bunExe(), "build", "--compile", "--aot", ...flags, main, "--outfile", executable],
              folder,
              bunEnv,
            ),
          );

          const ran = await spawned([executable], folder, env);
          expect(ran.signal).toBeNull();
          expect(told(ran)).toEqual(told(plain));
        }),
      600_000,
    );
  }
});
