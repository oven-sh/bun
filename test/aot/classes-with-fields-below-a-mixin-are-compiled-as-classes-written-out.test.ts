import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { buildCounted, countScript } from "./harness/counted-run";
import { slot } from "./run-programs";
import { test } from "./supported";

// The classes that the functions return declare fields, a private one among them. The class above is also constructed by itself and through a class written below it.
const timed = `{ started = 5; #ticks = 0; tick() { return ++this.#ticks + this.started; } }`;
const tagged = `{ tag = "t"; size() { return this.tag.length + this.id; } }`;
const rounds = (mixins: string, classes: string, expected: number, work = "a.tick() + b.tick() + b.size()") => `
    ${mixins}
    class Base { id = 1; }
    class Plain extends Base { plain = 2; }
    ${classes}
    const kept = [];
    function round(index) {
      const a = new A(), b = new B(), base = new Base(), plain = new Plain();
      if (index % 64 === 0) kept.push(a, b, base, plain);
      return ${work} + base.id + plain.plain + plain.id;
    }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index);
    console.log(sum === units * ${expected} && kept.every((object) => object.id === 1) ? "ok" : "no");
`;
const nested = `class A extends Timed(Base) {} class B extends Tagged(Timed(Base)) {}`;
const forms: Record<string, Record<string, string>> = {
  "arrows in constants": {
    "rounds.js": rounds(
      `const Timed = (Parent) => class extends Parent ${timed}; const Tagged = (Parent) => class extends Parent ${tagged};`,
      nested,
      18,
    ),
  },
  "declared functions": {
    "rounds.js": rounds(
      `function Timed(Parent) { return class extends Parent ${timed}; } function Tagged(Parent) { return class extends Parent ${tagged}; }`,
      nested,
      18,
    ),
  },
  "functions of another module over a class of a third": {
    "rounds.js": rounds(`import { Timed, Tagged } from "./mixins.js";`, nested, 18),
    "mixins.js": `export const Timed = (Parent) => class extends Parent ${timed}; export function Tagged(Parent) { return class extends Parent ${tagged}; }`,
  },
  "each function is called once": {
    "rounds.js": rounds(
      `const Timed = (Parent) => class extends Parent ${timed}; const Tagged = (Parent) => class extends Parent ${tagged};`,
      `class A extends Timed(Base) {} class B extends Tagged(Plain) {}`,
      14,
      "a.tick() + b.size() + b.plain",
    ),
  },
  "typed as the handbook writes it": {
    "rounds.ts": `
    type Constructor<T = {}> = new (...args: any[]) => T;
    function Timed<TBase extends Constructor>(Parent: TBase) { return class extends Parent { started = 5; #ticks = 0; tick(): number { return ++this.#ticks + this.started; } }; }
    function Tagged<TBase extends Constructor<{ id: number }>>(Parent: TBase) { return class extends Parent { tag = "t"; size(): number { return this.tag.length + this.id; } }; }
    class Base { id = 1; }
    class Plain extends Base { plain = 2; }
    class A extends Timed(Base) {}
    class B extends Tagged(Timed(Base)) {}
    const kept: Base[] = [];
    function idOf(object: Base): number { return object.id; }
    function round(index: number): number {
      const a = new A(), b = new B(), base = new Base(), plain = new Plain();
      if (index % 64 === 0) kept.push(a, b, base, plain);
      return a.tick() + b.tick() + b.size() + idOf(base) + plain.plain + idOf(plain) + idOf(a) + idOf(b);
    }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index);
    console.log(sum === units * 20 && kept.every((object) => object.id === 1) ? "ok" : "no");
`,
  },
};

test.each(Object.keys(forms))(
  "an object of a class below a function that returns a class with fields is made without the run time: %s",
  form =>
    slot(async () => {
      using dir = tempDir("aot-classes-with-fields-below-a-mixin", forms[form]);
      const folder = String(dir);
      const entry = Object.keys(forms[form])[0];
      const work = await countScript(await buildCounted(folder, `./${entry}`), folder, "ok\n");
      expect(work.accessesByName).toBe(0);
      expect(work.runtimeOperations).toEqual({});
    }),
  300_000,
);
