// A compiled function answers for `length`, `name` and the static fields of its class without storing them. the-suites-of-the-test-runner-run-compiled.test.ts runs mock-fn.test.js compiled too, but not under a sanitizer, and no case there writes to the spied function or spies on a class that nothing has used.
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

// What the cases of a kind spy on, one after another. A closure of the first four has neither key in its storage until something asks it to.
const kinds: [kind: string, ...spiedOn: string[]][] = [
  ["a function", `function made(a: unknown, b: unknown) {}`],
  ["a generator", `function* made(a: unknown, b: unknown) {}`],
  ["an async generator", `async function* made(a: unknown, b: unknown) {}`],
  ["a function that reads new.target", `function made(a: unknown, b: unknown) { return new.target; }`],
  ["a class", `class made { constructor(a: unknown, b: unknown) {} }`],
  // A spy marks a built-in for the rest of the run, so each case has a built-in of its own.
  ["a native function", `Math.max`, `Math.min`, `Math.hypot`, `Math.atan2`],
  [
    "a built-in written in JavaScript",
    `Array.prototype.map`,
    `Array.prototype.filter`,
    `Array.prototype.some`,
    `Array.prototype.every`,
  ],
];

const cases: [title: string, key: string, spy: string, answer: string, bound: string][] = [
  ["a value spy on the length", "length", `spyOn(fn, "length")`, `9`, `8`],
  ["a value spy on the name", "name", `spyOn(fn, "name")`, `"spied"`, `"bound spied"`],
  ["a getter spy on the length", "length", `spyOn(fn, "length", "get")`, `9`, `8`],
  ["a getter spy on the name", "name", `spyOn(fn, "name", "get")`, `"spied"`, `"bound spied"`],
];

test("bind() reads the spy, a refused write leaves it, and a restore brings the function back", async () => {
  using dir = tempDir("spy-on-length-or-name", {
    "one.test.ts": `
      import { expect, spyOn, test } from "bun:test";
      ${kinds
        .flatMap(([kind, ...spiedOn]) =>
          cases.map(
            ([title, key, spy, answer, bound], at) => `
      test(${JSON.stringify(`${title} of ${kind}`)}, () => {
        const fn: any = ${spiedOn[at % spiedOn.length]};
        const own = Object.getOwnPropertyDescriptor(fn, "${key}")!;
        const original = fn.bind(null, 1).${key};
        const spy = ${spy}.mockReturnValue(${answer});
        const bound = fn.bind(null, 1);
        expect(() => { fn.${key} = 5; }).toThrow(TypeError);
        expect([fn.${key}, bound.${key}]).toEqual([${answer}, ${bound}]);
        spy.mockRestore();
        expect([fn.${key}, bound.${key}, fn.bind(null, 1).${key}]).toEqual([own.value, ${bound}, original]);
        expect(Object.getOwnPropertyDescriptor(fn, "${key}")).toEqual(own);
      });`,
          ),
        )
        .join("\n")}`,
  });
  const plain = await runTests(String(dir));
  expect(plain).toMatchObject({
    results: kinds.flatMap(([kind]) => cases.map(([title]) => `pass ${title} of ${kind}`)),
    exitCode: 0,
  });
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
});

// The static field, what it is declared as, what the getter spy answers, and the length and name of `Class.bind(null, 1)` under that spy.
const fields: [key: string, declared: string, answer: string, bound: string][] = [
  ["version", `"1.0.0"`, `"spied"`, `[2, "bound plugin"]`],
  ["length", `3`, `9`, `[8, "bound plugin"]`],
  ["name", `"plugin"`, `"spied"`, `[2, "bound spied"]`],
];

test("a getter or a setter spy takes a static field of a class that nothing has used", async () => {
  // A class of its own for each case, where the code of the file runs: such a class keeps its static fields in variables until something makes its class object.
  const declare = (name: string) =>
    `class ${name} { static version = "1.0.0"; static length = 3; static name = "plugin"; }`;
  const restore = (name: string, key: string, declared: string) => `
        spy.mockRestore();
        expect([Object.getOwnPropertyNames(${name}), Object.getOwnPropertyDescriptor(${name}, "${key}")]).toEqual([
          ["length", "name", "prototype", "version"],
          { value: ${declared}, writable: true, enumerable: true, configurable: true },
        ]);`;
  using dir = tempDir("spy-on-static-field", {
    "one.test.js": `
      import { expect, spyOn, test } from "bun:test";
      ${fields
        .map(
          ([key, declared, answer, bound], at) => `
      ${declare(`Read${at}`)}
      test("a getter spy on the static field ${key}", () => {
        const spy = spyOn(Read${at}, "${key}", "get").mockReturnValue(${answer});
        const bound = Read${at}.bind(null, 1);
        expect(() => { Read${at}.${key} = 5; }).toThrow(TypeError);
        expect([Read${at}.${key}, [bound.length, bound.name]]).toEqual([${answer}, ${bound}]);${restore(`Read${at}`, key, declared)}
      });
      ${declare(`Written${at}`)}
      test("a setter spy on the static field ${key}", () => {
        const spy = spyOn(Written${at}, "${key}", "set");
        Written${at}.${key} = 5;
        expect(spy.mock.calls).toEqual([[5]]);${restore(`Written${at}`, key, declared)}
      });`,
        )
        .join("\n")}`,
  });
  const plain = await runTests(String(dir));
  expect(plain).toMatchObject({
    results: fields.flatMap(([key]) =>
      ["getter", "setter"].map(access => `pass a ${access} spy on the static field ${key}`),
    ),
    exitCode: 0,
  });
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
});
