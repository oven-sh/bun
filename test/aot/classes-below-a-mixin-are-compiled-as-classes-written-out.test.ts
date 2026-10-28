import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { buildCounted, countScript } from "./harness/counted-run";
import { slot } from "./run-programs";
import { test } from "./supported";

// A function that returns a class is called twice where classes are declared, over two bases.
const members = `
      constructor() { super(); this.n = 0; }
      increment() { return ++this.n; }
      get double() { return this.n * 2; }
      total() { return super.total() + this.n; }
`;
const rounds = (countable: string) => `
    ${countable}
    class Emitter { constructor() { this.listeners = 0; this.count = 0; } on() { this.listeners++; return this; } total() { return this.count + this.listeners; } }
    class Store { constructor() { this.size = 1; } total() { return this.size; } }
    class A extends Countable(Emitter) { constructor() { super(); this.a = 1; } }
    class B extends Countable(Store) { constructor() { super(); this.b = 2; } }
    const kept = [];
    function round(index) {
      const a = new A(), b = new B();
      if (index % 64 === 0) kept.push(a, b);
      a.on();
      return a.total() + b.total() + a.increment() + b.increment() + a.double + b.double + a.a + b.b;
    }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index);
    console.log(sum === units * 11 && kept.every((object) => object.n === 1) ? "ok" : "no");
`;
const forms: Record<string, Record<string, string>> = {
  "an arrow in a constant": { "rounds.js": rounds(`const Countable = (Base) => class extends Base {${members}};`) },
  "a declared function": {
    "rounds.js": rounds(`function Countable(Base) { return class extends Base {${members}}; }`),
  },
  "a declared function of another module": {
    "rounds.js": rounds(`import { Countable } from "./countable.js";`),
    "countable.js": `export function Countable(Base) { return class extends Base {${members}}; }`,
  },
};

test.each(Object.keys(forms))(
  "the members and fields of a class that a function returns are found where they are used: %s",
  form =>
    slot(async () => {
      using dir = tempDir("aot-classes-below-a-mixin", forms[form]);
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n");
      expect(work.accessesByName).toBe(0);
      expect(work.runtimeOperations).toEqual({});
    }),
  300_000,
);
