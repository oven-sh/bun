import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const asked = `import { test, expect, mock } from "bun:test";

const log = [];
const show = v => (v === null ? "null" : typeof v === "object" || typeof v === "symbol" || typeof v === "function" ? typeof v : typeof v + ":" + String(v));
expect.addEqualityTesters([(a, b) => (log.push(show(a) + "~" + show(b)), a === 5 || b === 5 ? false : undefined)]);

const key = Symbol("key");
class Point { constructor(x, y) { this.x = x; this.y = y; } }
class Deep extends Point { z = 5; }
const shared = { inner: 1 };

const holders = {
  "literal": () => ({ a: 5 }),
  "two fields": () => ({ a: 1, b: 5 }),
  "five first": () => ({ a: 5, b: 1 }),
  "no five": () => ({ a: 1, b: 2 }),
  "symbol key": () => ({ [key]: 5 }),
  "symbol first": () => ({ [key]: 1, a: 5, b: 2 }),
  "symbol last": () => ({ a: 1, [key]: 5, b: 2 }),
  "symbol between": () => ({ a: 1, [key]: 2, b: 3 }),
  "two symbols": () => ({ [Symbol.for("p")]: 1, a: 2, [Symbol.for("q")]: 5, b: 4 }),
  "symbol added later": () => { const o = { a: 1, b: 5 }; o[key] = 3; return o; },
  "symbol added first": () => { const o = {}; o[key] = 3; o.a = 5; return o; },
  "deleted and added": () => { const o = { a: 1, b: 2, c: 5 }; delete o.a; o.a = 1; return o; },
  "instance": () => new Point(1, 5),
  "derived": () => new Deep(1, 2),
  "instance with symbol": () => { const o = new Point(1, 2); o[key] = 5; o.late = 6; return o; },
  "nested": () => ({ a: { b: { c: 5 } } }),
  "nested beside": () => ({ a: { b: 1 }, c: { d: 5 }, e: 3 }),
  "in an array": () => [{ a: 5 }],
  "array in object": () => ({ a: [5] }),
  "array": () => [5],
  "map value": () => new Map([["a", { a: 5 }]]),
  "set": () => new Set([{ a: 5 }]),
  "typed array": () => ({ a: new Uint8Array([5]) }),
  "string": () => ({ a: "x", b: 5 }),
  "same object inside": () => ({ a: shared, b: 1 }),
  "NaN": () => ({ a: NaN, b: 1 }),
  "undefined value": () => ({ a: undefined, b: 5 }),
  "null prototype": () => Object.assign(Object.create(null), { a: 5 }),
  "index key": () => ({ 0: 5, a: 1 }),
  "getter": () => ({ get a() { return 5; } }),
  "frozen": () => Object.freeze({ a: 5 }),
  "spread": () => ({ ...{ a: 5 } }),
  "added later": () => { const o = { a: 1 }; o.late = 5; return o; },
  "parsed": () => JSON.parse('{"a":5}'),
  "hidden": () => { const o = { a: 5, b: 1 }; Object.defineProperty(o, "a", { enumerable: false }); return o; },
  "function field": () => ({ a: show, b: 5 }),
};

const matchers = {
  "toEqual": make => expect(make()).toEqual(make()),
  "toStrictEqual": make => expect(make()).toStrictEqual(make()),
  "toMatchObject": make => expect(make()).toMatchObject(make()),
  "toContainEqual": make => expect([{ other: 1 }, make()]).toContainEqual(make()),
  "not.toEqual": make => expect(make()).not.toEqual(make()),
  "objectContaining": make => expect(make()).toEqual(expect.objectContaining(make())),
  "not.objectContaining": make => expect(make()).toEqual(expect.not.objectContaining(make())),
  "objectContaining inside": make => expect({ w: make() }).toEqual({ w: expect.objectContaining(make()) }),
  "arrayContaining": make => expect([make()]).toEqual(expect.arrayContaining([make()])),
  "beside anything": make => expect({ w: make(), v: 1 }).toEqual({ w: make(), v: expect.anything() }),
  "toHaveProperty": make => expect({ w: make() }).toHaveProperty("w", make()),
  "toHaveBeenCalledWith": make => { const f = mock(); f(make()); expect(f).toHaveBeenCalledWith(make()); },
  "toHaveReturnedWith": make => { const f = mock(make); f(); expect(f).toHaveReturnedWith(make()); },
  "toContainValue": make => expect({ w: make() }).toContainValue(make()),
  "toBeOneOf": make => expect(make()).toBeOneOf([make()]),
  "toThrow": make => expect(() => { throw Object.assign(new Error("e"), { w: make() }); }).toThrow(expect.objectContaining({ w: make() })),
  "one object": make => { const o = make(); expect(o).toEqual(o); },
  "one object inside": make => { const o = make(); expect({ w: o }).toEqual({ w: o }); },
  "Bun.deepEquals": make => { if (!Bun.deepEquals(make(), make())) throw 1; },
  "Bun.deepEquals strict": make => { if (!Bun.deepEquals(make(), make(), true)) throw 1; },
};

test("asked", () => {
  for (const [holder, make] of Object.entries(holders)) {
    for (const [matcher, run] of Object.entries(matchers)) {
      log.length = 0;
      let passed = true;
      try { run(make); } catch { passed = false; }
      console.log("SAY " + holder + " | " + matcher + " | " + (passed ? "pass" : "fail") + " | " + log.length + " | " + log.join(" "));
    }
  }
});
`;

test("equality testers are asked about the pairs that bun test asks them about", async () => {
  using dir = tempDir("aot-equality-testers", { "asked.test.js": asked });
  const tell = async (...flags: string[]) => {
    const ran = await run([bunExe(), "test", ...flags, "./asked.test.js"], String(dir), { ...bunEnv, NO_COLOR: "1" });
    const said = (ran.stdout + ran.stderr).split("\n").filter(line => line.startsWith("SAY "));
    return { said, exitCode: ran.exitCode };
  };
  const compiled = await tell("--aot");
  expect(compiled.said).toContain("SAY literal | toEqual | fail | 2 | object~object number:5~number:5");
  expect(compiled.said).toContain(
    "SAY no five | toStrictEqual | pass | 3 | object~object number:1~number:1 number:2~number:2",
  );
  expect(compiled.said).toContain(
    "SAY symbol first | toEqual | fail | 3 | object~object number:1~number:1 number:5~number:5",
  );
  expect(compiled.said).toContain("SAY literal | Bun.deepEquals | pass | 0 | ");
  expect(compiled.said.length).toBe(36 * 20);
  expect(compiled).toEqual(await tell());
}, 240_000);
