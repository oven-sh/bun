import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { buildCounted, countScript } from "./harness/counted-run";
import { slot } from "./run-programs";
import { test } from "./supported";

// One class expression is evaluated many times, and each of its classes has a prototype object of its own. What is evaluated between two of them decides how far apart the prototype objects lie.
const rounds = (count: number, between: string) => `
    class Emitter { constructor() { this.events = undefined; this.count = 0; this.limit = 10; } on() { return this; } }
    const make = (Base, k) => class extends Base {
      constructor(name, i) { super(); this.name = name; this.state = i + k; }
    };
    const classes = [];
    const others = [];
    for (let k = 0; k < ${count}; k++) { classes.push(make(Emitter, k)); ${between} }
    function round() {
      let sum = 0;
      for (let k = 0; k < ${count}; k++) {
        const C = classes[k];
        const made = new C("n", 1);
        sum += made.state + made.count + made.limit + made.name.length + (Object.getPrototypeOf(made) === C.prototype ? 0 : 1000);
      }
      return sum;
    }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round();
    console.log(sum === units * ${12 * count + (count * (count - 1)) / 2} ? "ok" : "no");
  `;

async function expectNoRuntimeOperations(count: number, between: string) {
  using dir = tempDir("aot-classes-of-one-factory", { "rounds.js": rounds(count, between) });
  const folder = String(dir);
  const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n");
  expect(work.runtimeOperations).toEqual({});
}

test(
  "an object of a class that is evaluated many times is made where the constructor stands",
  () => slot(() => expectNoRuntimeOperations(24, "")),
  300_000,
);

test.each([
  [24, "one other class", "others.push(class {});"],
  [24, "three other classes", "others.push(class {}, class {}, class {});"],
  [40, "nothing", ""],
  [40, "one other class", "others.push(class {});"],
])(
  "so are the objects of %d classes with %s evaluated between two of them",
  (count, _, between) => slot(() => expectNoRuntimeOperations(count, between)),
  300_000,
);
