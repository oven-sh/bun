import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run as spawned } from "./harness/run";
import { describe, test } from "./supported";

// `import defer * as ns from "./a.mjs"` (https://tc39.es/proposal-defer-import-eval/). The module is loaded with its importer and
// evaluated, after what it imports, the first time a property is asked of `ns` by a string other than "then". `bun run` follows
// the proposal; ahead-of-time compiled programs must print the same, run in place or as an executable.

const files = {
  "a.mjs": `console.log("a is evaluated");
export let value = 1;
export function bump() { return ++value; }
export const arrow = () => value;
export const LIMIT = 10;
export class Thing { static made = 0; constructor() { Thing.made++; } }
export default "the default of a";
`,
  "b.mjs": `import "./dep-of-b.mjs";
console.log("b is evaluated");
export const name = "b";
`,
  "dep-of-b.mjs": `console.log("dep-of-b is evaluated");
`,
  "throws.mjs": `console.log("throws is evaluated");
throw new Error("thrown by the module");
export const never = 1;
`,
  "exports-then.mjs": `console.log("exports-then is evaluated");
export function then() { return "then was called"; }
export const other = 1;
`,
  "c.cjs": `console.log("c is evaluated");
exports.name = "c";
`,
  "helper.mjs": `import defer * as a from "./a.mjs";
console.log("helper is evaluated");
export const other = a;
export { a as handedOn };
`,
};

const programs: Record<string, string> = {
  "evaluated-at-the-first-read.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
console.log(a.value);
console.log(a.bump(), a.value, a.arrow(), a.default, a.LIMIT, new a.Thing() instanceof a.Thing, a.Thing.made);
`,
  "never-read.mjs": `import defer * as a from "./a.mjs";
console.log("main begins and ends");
`,
  "a-constant-is-a-read-too.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
if (a.LIMIT > 5) console.log("over five");
`,
  "a-call-is-a-read-too.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
console.log(a.bump((console.log("the argument is evaluated"), 1)));
`,
  "what-does-not-evaluate.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
const held = a;
console.log(typeof held, held === a, Object.prototype.toString.call(held), held[Symbol.toStringTag], typeof held.then, held[Symbol.iterator], Object.isExtensible(held), Symbol.toStringTag in held);
console.log("still not evaluated");
console.log(Object.keys(held).join());
`,
  "in-evaluates.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
console.log("value" in a, "missing" in a);
`,
  "own-keys-evaluate.mjs": `import defer * as b from "./b.mjs";
console.log("main begins");
console.log(Reflect.ownKeys(b).map(String).join());
`,
  "a-descriptor-evaluates.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
console.log(JSON.stringify(Object.getOwnPropertyDescriptor(a, "value")));
`,
  "delete-evaluates.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
console.log(Reflect.deleteProperty(a, "missing"), Reflect.deleteProperty(a, "value"));
`,
  "a-missing-name-evaluates.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
console.log(a.missing);
`,
  "a-computed-name-evaluates.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
const name = ["val", "ue"].join("");
console.log(a[name]);
`,
  "a-store-does-not-evaluate.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
console.log(Reflect.set(a, "value", 5));
console.log("main ends");
`,
  "then-is-no-export.mjs": `import defer * as t from "./exports-then.mjs";
console.log("main begins");
console.log(t.then, "then" in t, Reflect.getOwnPropertyDescriptor(t, "then"));
const resolved = await Promise.resolve(t);
console.log(resolved === t, "not evaluated yet");
console.log(t.other, t.then, Object.keys(t).join());
`,
  "dependencies-are-deferred-too.mjs": `import defer * as b from "./b.mjs";
console.log("main begins");
console.log(b.name);
`,
  "also-imported-at-once.mjs": `import defer * as a from "./a.mjs";
import { value } from "./a.mjs";
console.log("main begins", value, a.value);
`,
  "a-module-that-throws.mjs": `import defer * as t from "./throws.mjs";
console.log("main begins");
for (const time of [1, 2]) { try { console.log(t.never); } catch (error) { console.log("caught:", error.message); } }
const held = t;
try { Object.keys(held); } catch (error) { console.log("caught:", error.message); }
`,
  "commonjs.mjs": `import defer * as c from "./c.cjs";
console.log("main begins");
console.log(c.name, c.default.name);
`,
  "built-in.mjs": `import defer * as path from "node:path";
console.log("main begins", typeof path.join);
`,
  "two-importers.mjs": `import defer * as a from "./a.mjs";
import { other, handedOn } from "./helper.mjs";
console.log("main begins", other === a, handedOn === a);
console.log(handedOn.value);
`,
  "reexport-read-through-namespace.mjs": `import defer * as a from "./a.mjs";
import * as helper from "./helper.mjs";
const name = ["handed", "On"].join("");
console.log("main begins", helper.handedOn === a, helper[name] === a, Object.prototype.toString.call(helper[name]));
console.log(helper[name].value);
`,
  "another-object-than-the-eager-one.mjs": `import defer * as deferred from "./a.mjs";
import * as eager from "./a.mjs";
console.log("main begins", deferred === eager, Object.prototype.toString.call(deferred), Object.prototype.toString.call(eager), deferred.value === eager.value);
`,
  "typescript.ts": `import defer * as a from "./a.mjs";
console.log("main begins");
const value: number = a.value;
console.log(value, a.bump());
`,
  "in-a-function.mjs": `import defer * as a from "./a.mjs";
function late() { return a.value; }
console.log("main begins");
setTimeout(() => console.log("timer", late()), 0);
console.log("main ends");
`,
  "in-a-loop-that-does-not-run.mjs": `import defer * as a from "./a.mjs";
console.log("main begins");
for (let i = 0; i < process.argv.length - 99; i++) console.log(a.value);
console.log("main ends");
`,
};

const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  const tree = {
    ...files,
    [entry]: programs[entry],
    "tsconfig.json": `{ "compilerOptions": { "module": "esnext", "moduleResolution": "bundler", "allowJs": true, "types": [] } }`,
  };

  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("import-defer", tree);
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    const aot = await spawned([bunExe(), "run", "--debug-aot", entry], String(dir), compiledOnly);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test("bun build --compile --aot prints what bun run prints", async () => {
    using dir = tempDir("import-defer", tree);
    const plain = await spawned([bunExe(), "run", entry], String(dir));
    const built = await spawned([bunExe(), "build", "--compile", "--aot", entry, "--outfile", "program"], String(dir));
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const aot = await spawned([join(String(dir), "program")], String(dir), compiledOnly);
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
