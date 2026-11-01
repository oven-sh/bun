// `const point = { .. }; Point.prototype = point;`: the prototype object of a constructor function is an ordinary object, under a name as where the
// literal is written in place. The run time watches the members of a class on an ordinary object alone: above a compiled one the guard of
// each member fails at every read, and the read goes by name.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { slot } from "./harness/commands";
import { buildCounted, countScript } from "./harness/counted-run";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const rounds = `
  const target = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7 };
  function Heir(b) { this.b = b; }
  Heir.prototype = target;
  const heirs = [new Heir(1), new Heir(2)];
  const units = Number(process.argv[2]);
  let sum = 0;
  for (let unit = 0; unit < units; unit++) {
    const heir = heirs[unit & 1];
    sum += heir.one + heir.two() + heir.kind;
  }
  console.log(sum > 0 ? "ok" : "no");
`;

test(
  "a getter, a method and a value of a named literal are read through an heir without a test that fails",
  () =>
    slot(async () => {
      using dir = tempDir("aot-named-prototype", { "rounds.js": rounds });
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n", {
        warmUp: 2,
        units: 10,
      });
      const guards = [...work.tests, ...work.uneven].filter(counted => counted.kind === "AreMembersUnchanged");
      // A renamed test would count nothing.
      expect(guards.length).toBeGreaterThan(0);
      expect(guards.filter(counted => counted.failed)).toEqual([]);
    }),
  300_000,
);

const programs = {
  "mutations.cjs": `// Each way of changing what an heir finds, after the read is hot. One line a case.
const cases = {
  "nothing": () => {},
  "defineProperty, another getter": t => Object.defineProperty(t, "one", { get() { return -1; }, configurable: true }),
  "defineProperty, a value": t => Object.defineProperty(t, "one", { value: -2, configurable: true }),
  "delete": t => { delete t.one; },
  "assignment, sloppy": t => { t.one = -3; },
  "Object.assign": t => { try { Object.assign(t, { one: -4 }); } catch (error) { return error.name; } },
  "Reflect.set": t => Reflect.set(t, "one", -5),
  "Reflect.defineProperty": t => Reflect.defineProperty(t, "one", { value: -6, configurable: true }),
  "__defineGetter__": t => t.__defineGetter__("one", () => -7),
  "setPrototypeOf of the object above": t => { delete t.one; Object.setPrototypeOf(t, { one: -8 }); },
  "an own property of the heir": (t, heirs) => { Object.defineProperty(heirs[0], "one", { value: -9 }); },
  "setPrototypeOf of the heir": (t, heirs) => Object.setPrototypeOf(heirs[1], { one: -10, two() { return 0; }, kind: 0 }),
  "freeze": t => Object.freeze(t),
  "a method replaced": t => { t.two = function () { return -11; }; },
  "a value replaced": t => { t.kind = -12; },
  "a value replaced under a key that nobody spells": t => { t[["ki", "nd"].join("")] = -13; },
  "a setter added": t => Object.defineProperty(t, "one", { get() { return this.b + 1; }, set(v) { this.b = v; }, configurable: true }),
};
for (const [name, change] of Object.entries(cases)) {
  const target = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7, b: 3 };
  function H(b) { this.b = b; }
  H.prototype = target;
  const heirs = [new H(1), new H(2)];
  const sum = () => { let s = 0; for (let i = 0; i < 20000; i++) { const h = heirs[i & 1]; s += h.one + h.two() + h.kind; } return s; };
  const before = sum();
  const said = change(target, heirs);
  heirs[0].one = 40;
  console.log(name, "|", before, sum(), String(said), "|", target.b, target.kind, typeof target.two, Object.keys(target).join(), JSON.stringify(target), Object.getOwnPropertyNames(target).join());
}
`,
  "once.cjs": `// The same at the top of a module, where each literal is made once, and with heirs by Object.create and setPrototypeOf.
const target = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7, b: 3 };
function H(b) { this.b = b; }
H.prototype = target;
const made = { get one() { return this.b * 2; }, two() { return this.b * 3; }, kind: 9 };
const set = { get one() { return this.b * 5; }, kind: 11 };
const heirs = [new H(1), Object.assign(Object.create(made), { b: 2 }), Object.setPrototypeOf({ b: 3 }, set)];
const sum = () => { let s = 0; for (let i = 0; i < 30000; i++) { const h = heirs[i % 3]; s += h.one + h.kind; } return s; };
console.log(sum(), target.one, target.two(), made.one, set.kind, target instanceof Object, H.prototype === target, Object.getPrototypeOf(heirs[1]) === made);
target.kind = 100; made.kind = 200; set.kind = 300;
console.log(sum());
Object.defineProperty(target, "one", { value: 1000 }); delete made.one; set.one = 5;
console.log(sum(), JSON.stringify([target, made, set]), Object.keys(target).join(), "one" in made);
for (const key in heirs[0]) console.log("key", key);
console.log(target.hasOwnProperty("kind"), Object.entries(made).length, structuredClone({ ...set }).kind, String(target), target.toString === Object.prototype.toString);
`,
  "typed.ts": `// A constant of an inferred or a written object type that now holds an ordinary object.
interface Shape { kind: number; b: number; readonly one: number; two(): number }
const inferred = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 7, b: 3 };
const written: Shape = { get one() { return this.b + 1; }, two() { return this.b + 2; }, kind: 8, b: 4 };
const satisfied = { get one(): number { return this.b + 1; }, two(): number { return this.b + 2; }, kind: 9, b: 5 } satisfies Shape;
function H(this: any, b: number) { this.b = b; }
H.prototype = inferred;
const heirs: Shape[] = [new (H as any)(1), Object.create(written), Object.setPrototypeOf({ b: 6 }, satisfied)];
const read = (shape: Shape): number => shape.one + shape.two() + shape.kind + shape.b;
let s = 0;
for (let i = 0; i < 30000; i++) s += read(heirs[i % 3]) + read(inferred) + read(written) + read(satisfied);
console.log(s, inferred.b, written.kind, satisfied.two(), JSON.stringify([inferred, written, satisfied]));
inferred.b = 10; written.kind = 20; satisfied.b = 30;
const { kind, ...rest } = written;
console.log(read(inferred), read(written), read(satisfied), kind, Object.keys(rest).join(), [inferred, written].map(it => it.one).join());
export { inferred, written };
`,
};

test.each(Object.keys(programs))(
  "%s answers as under plain Bun",
  name =>
    slot(async () => {
      using dir = tempDir("aot-named-prototype", programs);
      const folder = String(dir);
      const executable = join(folder, "compiled");
      const built = await run([bunExe(), ...compileCommand, name, "--outfile", executable], folder, bunEnv);
      expect({ exitCode: built.exitCode, said: built.exitCode ? built.stdout + built.stderr : "" }).toEqual({
        exitCode: 0,
        said: "",
      });
      const plain = await run([bunExe(), name], folder, bunEnv);
      expect(plain.stdout.split("\n").length).toBeGreaterThan(2);
      expect(await run([executable], folder, bunEnv)).toEqual(plain);
    }),
  300_000,
);
