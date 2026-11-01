import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const prelude = `
  import { test } from "bun:test";
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");
  function withDescriptor(name, descriptor, store) {
    Object.defineProperty(Object.prototype, "__proto__", { configurable: true, ...descriptor });
    let outcome = "no error";
    try {
      store();
    } catch (error) {
      outcome = error.name + ": " + error.message;
    } finally {
      Object.defineProperty(Object.prototype, "__proto__", original);
    }
    console.log(name + ":", outcome);
  }`;

const files = {
  "answers.test.js": `${prelude}
    const stores = {
      "Array.prototype": () => { Array.prototype.__proto__ = 1; },
      "Array": () => { Array.__proto__ = null; },
      "Map.prototype": () => { Map.prototype.__proto__ = {}; },
      "Math": () => { Math.__proto__ = 4; },
      "JSON": () => { JSON.__proto__ = Array.prototype; },
      "Function.prototype": () => { Function.prototype.__proto__ = 6; },
      "by a key that is put together": () => { Array.prototype[["__pro", "to__"].join("")] = 7; },
      "Reflect.set": () => { console.log(Reflect.set(Array.prototype, "__proto__", 8)); },
      "an object of the test": () => { ({}).__proto__ = 9; },
      "a list of the test": () => { [].__proto__ = 10; },
    };
    test("the setter of the test is called, and the object stays as it is", () => {
      for (const [name, store] of Object.entries(stores)) {
        const seen = [];
        withDescriptor(name, { get: original.get, set(value) { seen.push(typeof value, this === globalThis ? "globalThis" : typeof this); } }, store);
        console.log(" ", seen.join());
      }
      console.log([Array.prototype, Map.prototype, Math, JSON, Function.prototype].every(object => Object.getPrototypeOf(object) === Object.prototype), Object.getPrototypeOf(Array) === Function.prototype);
      console.log([Array.prototype, Array, Math, JSON].some(object => Object.hasOwn(object, "__proto__")));
    });
    test("a setter that throws, and no setter at all", () => {
      withDescriptor("throws", { set() { throw new RangeError("from the setter"); } }, () => { Math.__proto__ = 1; });
      withDescriptor("a getter alone", { get() { return 1; } }, () => { Math.__proto__ = 1; });
      withDescriptor("a getter alone, Reflect.set", { get() { return 1; } }, () => { console.log(Reflect.set(Math, "__proto__", 1)); });
    });
    test("with the accessor back in its place", () => {
      Array.prototype.__proto__ = 1;
      Array.prototype.__proto__ = Object.prototype;
      console.log(Object.getPrototypeOf(Array.prototype) === Object.prototype);
    });`,
};

// A store that finds a value above gives the built-in object a property of its own, under a name that it only inherits. Whoever reads the name finds it there.
const value = {
  "reads.js": `
    export const byName = object => object.__proto__;
    export const byKey = (object, key) => object[key];
    export const ofMath = () => Math.__proto__;
    export const walks = () => [Math.abs(-1), Math.hasOwnProperty("abs"), String(Math), Object.getPrototypeOf(Math) === Object.prototype].join();`,
  "value.test.js": `${prelude}
    import { byKey, byName, ofMath, walks } from "./reads.js";
    const look = () => console.log(typeof Math.__proto__, typeof ofMath(), typeof byName(Math), typeof byKey(Math, ["__pro", "to__"].join("")), Object.hasOwn(Math, "__proto__"), Object.keys(Math).join(), walks());
    test("a value in place of the accessor", () => {
      look();
      withDescriptor("a value", { value: 1, writable: true }, () => { look(); Math.__proto__ = 2; look(); });
      look();
      console.log(delete Math.__proto__);
      look();
    });`,
};

const refused = {
  "refused.test.js": `${prelude}
    test("the accessor of the engine", () => {
      try {
        Array.prototype.__proto__ = null;
        console.log("no error");
      } catch (error) {
        console.log(error.name);
      }
      console.log(Object.getPrototypeOf(Array.prototype) === Object.prototype);
    });`,
};

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, ""), exitCode };
}

const ways = [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
];

test.each(ways)("the accessor of the test answers, %s", async (_, words) => {
  using directory = tempDir("accessor-in-place-of-proto", files);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain("Array.prototype: no error\n  number,object");
  expect(plain.printed).toContain("throws: RangeError: from the setter");
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});

test.each(ways)("what would change the built-in object is still refused, %s", async (_, words) => {
  using directory = tempDir("accessor-in-place-of-proto-refused", refused);
  const { printed } = await printedBy(String(directory), words, "--aot");
  expect(printed).toContain("TypeError\ntrue");
});

test.each(ways)("a value in place of the accessor is stored over and read as in a plain run, %s", async (_, words) => {
  using directory = tempDir("value-in-place-of-proto", value);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain(
    "a value: no error\nnumber number number number true __proto__ 1,true,[object Math],true",
  );
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
