// A spy on the getter or the setter under an index asks whether the object answers for its elements by itself, as a typed array does: an accessor laid in its storage would then be
// ignored. An object of compiled code looks its indices up by itself too, but in a second object that takes an accessor like any other, and the spy refused it all the same.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

// Whatever goes through `look` is built as an object, however little else the test does with it.
const head = `
  import { expect, spyOn, test } from "bun:test";
  const seen = [];
  function look(value) {
    seen.push(value);
    return value;
  }`;

const cases: [string, string][] = [
  [
    "a getter written in a literal",
    `const holder = look({ a: 1, get 0() { return 1; } });
     spyOn(holder, 0, "get").mockReturnValue(2);
     expect(holder[0]).toBe(2);`,
  ],
  [
    "a setter defined on an instance of a class",
    `class Made { a = 1; }
     let kept = 0;
     const holder = look(new Made());
     Object.defineProperty(holder, 7, { set(value) { kept = value; }, configurable: true });
     const spy = spyOn(holder, 7, "set");
     holder[7] = 5;
     expect([kept, spy.mock.calls]).toEqual([5, [[5]]]);`,
  ],
  [
    "a value under an index, spied on as a getter",
    `const holder = look({ a: 1, 0: 1 });
     spyOn(holder, "0", "get").mockReturnValue(2);
     expect(holder[0]).toBe(2);`,
  ],
  [
    "the getter comes back when the spy is restored",
    `const holder = look({ a: 1, get 0() { return 1; } });
     const getter = Object.getOwnPropertyDescriptor(holder, 0).get;
     const spy = spyOn(holder, 0, "get").mockReturnValue(2);
     expect(holder[0]).toBe(2);
     spy.mockRestore();
     expect([holder[0], Object.getOwnPropertyDescriptor(holder, 0).get === getter, Object.keys(holder)]).toEqual([1, true, ["0", "a"]]);`,
  ],
  [
    "a getter that may not be redefined stays",
    `const holder = look({ a: 1 });
     Object.defineProperty(holder, 0, { get() { return 1; }, configurable: false });
     spyOn(holder, 0, "get").mockReturnValue(2);
     expect(holder[0]).toBe(1);`,
  ],
  [
    "a typed array is refused as before",
    `const holder = look(new Uint8Array(2));
     expect(() => spyOn(holder, 0, "get")).toThrow("cannot be redefined");`,
  ],
];

for (const [what, body] of cases) {
  test(what, async () => {
    using dir = tempDir("spy-under-an-index", { "one.test.js": `${head}\n  test("it", () => {\n     ${body}\n  });` });
    const plain = await runTests(String(dir));
    expect(plain.results).toEqual(["pass it"]);
    expect(await runTests(String(dir), "--aot")).toEqual(plain);
  });
}
