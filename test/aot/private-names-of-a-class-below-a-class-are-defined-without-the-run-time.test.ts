import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { buildCounted, countScript } from "./harness/counted-run";
import { slot } from "./run-programs";
import { test } from "./supported";

// A class below a class declares private names. Its objects, and those of the classes below it, are kept, so they are made.
const forms: Record<string, string> = {
  "a private field": `
    class Base { id = 1; }
    class Timed extends Base { started = 5; #ticks = 0; tick() { return ++this.#ticks + this.started; } }
    class A extends Timed {}
    class Tagged extends A { tag = "t"; size() { return this.tag.length + this.id; } }
    class B extends Tagged {}
    const work = (a, b) => a.tick() + b.tick() + b.size();
    const expected = 14;`,
  "a private method and a private accessor": `
    class Base { id = 1; }
    class Timed extends Base { #ticks = 0; #next() { return ++this.#ticks; } get #twice() { return this.#ticks * 2; } tick() { return this.#next() + this.#twice; } }
    class A extends Timed {}
    class B extends A { tag = "t"; }
    const work = (a, b) => a.tick() + b.tick() + b.tag.length;
    const expected = 7;`,
  "private fields at two levels": `
    class Base { #root = 1; root() { return this.#root; } }
    class Middle extends Base { #middle = 2; middle() { return this.#middle + this.root(); } }
    class A extends Middle { #leaf = 4; tick() { return this.#leaf + this.middle(); } }
    class B extends Middle { tick() { return this.middle(); } }
    const work = (a, b) => a.tick() + b.tick();
    const expected = 10;`,
};

test.each(Object.keys(forms))(
  "an object of a class below a class gets its private names without the run time: %s",
  form =>
    slot(async () => {
      using dir = tempDir("aot-private-names-below-a-class", {
        "rounds.js": `${forms[form]}
    const kept = [];
    function round(index) {
      const a = new A(), b = new B();
      kept[index & 7] = a;
      kept[8 + (index & 7)] = b;
      return work(a, b);
    }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index);
    console.log(sum === units * expected && kept.length === 16 ? "ok" : "no");
`,
      });
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n");
      expect(work.runtimeOperations).toEqual({});
    }),
  300_000,
);
