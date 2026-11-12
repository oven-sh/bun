import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Compiled code doesn't ask a built-in constructor for its Symbol.hasInstance before an `instanceof`.
const names = ["Array", "Map", "Set", "WeakMap", "Promise", "Date", "RegExp", "Error", "Object", "Function", "Uint8Array", "ArrayBuffer", "URL", "Buffer", "EventTarget", "Response"]; // prettier-ignore
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "a.test.js": `import { test } from "bun:test";
class Own {}
test("lays", () => {
  for (const constructor of [${names.join(", ")}, Own]) {
    let how = "laid";
    try {
      Object.defineProperty(constructor, Symbol.hasInstance, { value: () => true, configurable: true });
    } catch (error) {
      how = error.name;
    }
    console.log("SAID", constructor.name, how, 1 instanceof constructor);
    delete constructor[Symbol.hasInstance];
  }
});`,
};
const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID ")).map(line => line.slice(5)); // prettier-ignore

test("Symbol.hasInstance on a built-in constructor throws in a compiled test run, and one on a class of the test works", async () => {
  using dir = tempDir("aot-has-instance", files);
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(said(compiled.stdout)).toEqual([...names.map(name => `${name} TypeError false`), "Own laid true"]);
  const plain = await run([bunExe(), "test"], String(dir), bunEnv);
  expect(said(plain.stdout)).toEqual([...names, "Own"].map(name => `${name} laid true`));
}, 300000);
