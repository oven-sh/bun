import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `class Middle extends Base` whose constructor runs only because a class below calls super() has no objects of its own, and the compiler
// keeps no fields for them. Each part of the program makes an object of a class in the middle after all, by a way other than `new Middle()`.
const program = `
const show = (label, object) => console.log(label, object.constructor.name, JSON.stringify(object), Object.keys(object).join());

class Base { constructor() { this.a = 1; } }
class Middle extends Base { constructor() { super(); this.b = 2; } }
class Top extends Middle { constructor() { super(); this.c = 3; } }
show("only the class below", new Top());

class Base2 { constructor() { this.a = 1; } }
class Middle2 extends Base2 { constructor() { super(); this.b = 2; } }
class Top2 extends Middle2 { constructor() { super(); this.c = 3; } }
show("below", new Top2());
show("Reflect.construct of the middle", Reflect.construct(Middle2, []));

class Base3 { constructor() { this.a = 1; } }
class Middle3 extends Base3 { constructor() { super(); this.b = 2; } }
class Top3 extends Middle3 { constructor() { super(); this.c = 3; } }
show("below", new Top3());
show("the middle as new.target of the base", Reflect.construct(Base3, [], Middle3));
show("the middle as new.target of the class below", Reflect.construct(Top3, [], Middle3));
show("the middle as new.target of Object", Reflect.construct(Object, [], Middle3));

class Base4 { constructor() { this.a = 1; } again() { return new this.constructor(); } }
class Middle4 extends Base4 { constructor() { super(); this.b = 2; } up() { return new (Object.getPrototypeOf(this.constructor))(); } }
class Top4 extends Middle4 { constructor() { super(); this.c = 3; } }
show("this.constructor", new Top4().again());
show("the class object above", new Top4().up());

class Base5 { constructor() { this.a = 1; } }
class Middle5 extends Base5 { constructor() { super(); this.b = 2; } }
class Top5 extends Middle5 { constructor() { super(); this.c = 3; } }
globalThis["held" + String(5)] = Middle5;
show("below", new Top5());
show("through a name nobody knows", new globalThis["held" + String(10 / 2)]());

class MiddleError extends Error { constructor(text) { super(text); this.b = 2; } }
class TopError extends MiddleError { constructor(text) { super(text); this.c = 3; } }
const error = new TopError("late");
console.log("below a built-in class", error.constructor.name, error.message, error.b, error.c, error instanceof MiddleError, error instanceof Error);

class MiddleList extends Array { constructor(...items) { super(...items); this.b = 2; } }
class TopList extends MiddleList { constructor(...items) { super(...items); this.c = 3; } static get [Symbol.species]() { return MiddleList; } }
const mapped = new TopList(1, 2, 3).map(item => item * 2);
console.log("species", mapped.constructor.name, mapped.join(), mapped.b, mapped.c);

class Base6 { constructor() { this.a = 1; return { other: true }; } }
class Middle6 extends Base6 { constructor() { super(); this.b = 2; } }
class Top6 extends Middle6 { constructor() { super(); this.c = 3; } }
show("the base answers another object", new Top6());

function mix(Above, name) { return class extends Above { constructor() { super(); this[name] = name.length; } }; }
let Stacked = class { constructor() { this.base = 0; } };
const made = [Stacked];
for (const name of ["one", "three", "fifteen"]) made.push(Stacked = mix(Stacked, name));
console.log("one mixin three times", JSON.stringify(new Stacked()), JSON.stringify(new made[2]()));

function first(Above) { return class extends Above { constructor() { super(); this.first = 1; } }; }
function second(Above) { return class extends Above { constructor() { super(); this.second = 2; } }; }
function third(Above) { return class extends Above { constructor() { super(); this.third = 3; } }; }
const Whole = third(second(first(Base)));
const whole = new Whole();
console.log("three mixins", JSON.stringify(whole), whole.first + whole.second + whole.third + whole.a);

class Base7 { constructor() { this.a = 1; } }
class Middle7 extends Base7 { b = 2; constructor() { super(); this.seen = new.target.name; } }
class Top7 extends Middle7 { c = 3; }
for (const chosen of [Top7, Top7, Middle7]) show("chosen in a loop", new chosen());
`;

test("an object of a class in the middle, made by another way than `new`, has its fields", async () => {
  using dir = tempDir("aot-classes-that-run-only-for-super", { "main.js": program });
  const directory = String(dir);
  const plain = await run([bunExe(), "main.js"], directory, bunEnv);
  expect(plain.stdout.split("\n")[0]).toBe(`only the class below Top {"a":1,"b":2,"c":3} a,b,c`);
  const executable = join(directory, "classes");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable],
    directory,
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], directory, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 120_000);
