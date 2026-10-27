import { expect } from "bun:test";
import { tempDirWithBunTypes as tempDir } from "harness";
import { buildCounted, countScript } from "./harness/counted-run";
import { slot } from "./run-programs";
import { test } from "./supported";

// A class without fields stands below a built-in class. Its objects are made once and kept; the rounds call its methods, which call those of the class above.
const forms: Record<string, string> = {
  "below Map": `
    class Defaults extends Map { getOr(key, fallback) { return this.get(key) ?? fallback; } }
    const held = new Defaults([["a", 1]]);
    const work = (index) => held.getOr(index & 1 ? "a" : "b", 9);
    const expected = 10;`,
  "below Set": `
    class Tags extends Set { count(tag) { return this.has(tag) ? 1 : 9; } }
    const held = new Tags(["a"]);
    const work = (index) => held.count(index & 1 ? "a" : "b");
    const expected = 10;`,
  "below a class below Map": `
    class Top extends Map { read(key) { return this.get(key); } }
    class Low extends Top { getOr(key, fallback) { return this.read(key) ?? fallback; } }
    const held = new Low([["a", 1]]);
    const work = (index) => held.getOr(index & 1 ? "a" : "b", 9);
    const expected = 10;`,
};

test.each(Object.keys(forms))(
  "the methods of a class below a built-in class are found without a look by name: %s",
  form =>
    slot(async () => {
      using dir = tempDir("aot-classes-below-built-in-classes", {
        "rounds.js": `${forms[form]}
    function round(index) { return work(index) + work(index + 1); }
    let sum = 0;
    const units = Number(process.argv[2]);
    for (let index = 0; index < units; index++) sum += round(index);
    console.log(sum === units * expected ? "ok" : "no");
`,
      });
      const folder = String(dir);
      const work = await countScript(await buildCounted(folder, "./rounds.js"), folder, "ok\n");
      expect(work.accessesByName).toBe(0);
      expect(work.runtimeOperations).toEqual({});
    }),
  300_000,
);
