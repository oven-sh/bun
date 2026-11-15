// Bun's own modules make safe copies of `Map`, `Set` and `WeakMap` as they load (internal:primordials): a class of their own that owns what the prototype owned at that moment.
// A preload may have laid another class there by then, or taken a member away. The text that the compiler reads (src/js/ahead-of-time) writes the copying out for the members of the real
// classes. A class that does not own each of them used to stop the load, "Property description must be an object.", or, for `WeakMap`, got members that `bun test` does not give it.
// It goes by what it owns now, as in the other text. So the safe copy of a bare subclass has no methods: under `bun test` too, whoever then needs one of them throws.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const circular = "<ref *1> { a: 1, o: [Circular *1] }";
const cases: Record<string, { lay: string; plain: string[] }> = {
  "a bare subclass of Map": {
    lay: `globalThis.Map = class Wider extends Map {};`,
    plain: ["TypeError: wellKnownPrototypes.set is not a function", "0", "null"],
  },
  "a bare subclass of Set": {
    lay: `globalThis.Set = class Wider extends Set {};`,
    plain: [
      "TypeError: 'add' property of a Set should be callable.",
      "TypeError: 'add' property of a Set should be callable.",
      "null",
    ],
  },
  "a bare subclass of WeakMap": {
    lay: `globalThis.WeakMap = class Wider extends WeakMap {};`,
    plain: [circular, "TypeError: this.#trackedFunctions.set is not a function", "null"],
  },
  // Each function of its own that takes no parameter is called once, and the first that makes an iterator once more.
  "a class of its own with fewer members": {
    lay: `globalThis.made = { entries: 0, clear: 0 };
globalThis.Map = class Listed {
  #keys = []; #values = [];
  get(key) { return this.#values[this.#keys.indexOf(key)]; }
  set(key, value) { this.#keys.push(key); this.#values.push(value); return this; }
  has(key) { return this.#keys.includes(key); }
  clear() { made.clear++; }
  entries() { made.entries++; return this.#keys.map((key, i) => [key, this.#values[i]])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
};`,
    plain: [circular, "0", `{"entries":3,"clear":1}`],
  },
  "the getter of size is gone": {
    lay: `delete Map.prototype.size;`,
    plain: [circular, "0", "null"],
  },
};

for (const [title, { lay, plain }] of Object.entries(cases))
  test.concurrent(title, async () => {
    using dir = tempDir("aot-safe-by-what-it-owns", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "bunfig.toml": `[test]\npreload = ["./before.js"]\n`,
      "before.js": lay,
      "a.test.js": `import { test } from "bun:test";
import util from "node:util";
import assert from "node:assert";
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name + ": " + e.message.split(". (In")[0]; } };
test("t", () => {
  const circular = { a: 1 };
  circular.o = circular;
  console.error("SEEN " + say(() => util.inspect(circular)));
  console.error("SEEN " + say(() => { const tracker = new assert.CallTracker(); tracker.calls(() => 1, 1)(); return tracker.report().length; }));
  console.error("SEEN " + JSON.stringify(globalThis.made ?? null));
});
`,
    });
    const seenWith = async (...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN "));
      return { seen: lines.map(line => line.slice(5)), exitCode };
    };
    expect(await seenWith()).toEqual({ seen: plain, exitCode: 0 });
    expect(await seenWith("--aot")).toEqual({ seen: plain, exitCode: 0 });
  });
