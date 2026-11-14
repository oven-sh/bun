import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const proxyAbovePrototype = `
  class Made {}
  Object.setPrototypeOf(Made.prototype, new Proxy({}, {}));`;

async function runTests(directory: string, ...flags: string[]) {
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { results, exitCode };
}

async function expectCompiledToPassAsPlain(files: Record<string, string>) {
  using dir = tempDir("elements-of-arrays-in-a-test-run", files);
  const plain = await runTests(String(dir));
  expect(plain).toEqual({ results: ["pass it"], exitCode: 0 });
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

const elements = {
  "Object.keys": `Object.keys({ name: 1 })`,
  "Object.entries": `Object.entries({ name: 1 })`,
  "Object.freeze": `Object.freeze({ name: 1 })`,
  "Object.create": `Object.create(null)`,
  "Object.getOwnPropertyNames": `Object.getOwnPropertyNames({ name: 1 })`,
  "Object.getOwnPropertyDescriptor": `Object.getOwnPropertyDescriptor({ name: 1 }, "name")`,
  "Object.getOwnPropertyDescriptors": `Object.getOwnPropertyDescriptors({ name: 1 })`,
};

test.concurrent.each(Object.entries(elements))(
  "what %s returns is an element of an array at the top level of a module",
  async (_name, element) => {
    await expectCompiledToPassAsPlain({
      "list.ts": `
        const LIST = [${element}];
        export function kind() {
          return typeof LIST[0];
        }`,
      "list.test.ts": `
        import { expect, test } from "bun:test";
        import { kind } from "./list.ts";
        test("it", () => {${proxyAbovePrototype}
          expect(kind()).toBe("object");
        });`,
    });
  },
);

test.concurrent("a property of such an element is read under a name that varies", async () => {
  await expectCompiledToPassAsPlain({
    "tables.ts": `
      const TABLES = [Object.getOwnPropertyDescriptors({ name: 1, message: 2 })];
      export function kind(key: "name" | "message") {
        for (let i = 0; i < TABLES.length; i++) return typeof TABLES[i]![key];
      }`,
    "tables.test.ts": `
      import { expect, test } from "bun:test";
      import { kind } from "./tables.ts";
      test("it", () => {${proxyAbovePrototype}
        expect([kind("name"), kind("message")]).toEqual(["object", "object"]);
      });`,
  });
});

test.concurrent(
  "a native getter out of a table of descriptors is applied to an error without a prototype",
  async () => {
    await expectCompiledToPassAsPlain({
      "text.ts": `
      function descriptorTable(holder: object): PropertyDescriptorMap {
        return Object.freeze(Object.setPrototypeOf(Object.getOwnPropertyDescriptors(holder), null));
      }
      const TABLES = [descriptorTable(Map.prototype), descriptorTable(DOMException.prototype)];
      function text(value: object, key: "name" | "message"): string | undefined {
        for (let owner: object | null = value; owner; owner = Reflect.getPrototypeOf(owner)) {
          const descriptor = Reflect.getOwnPropertyDescriptor(owner, key);
          if (descriptor && Object.hasOwn(descriptor, "value")) return String(descriptor.value);
        }
        for (let i = 0; i < TABLES.length; i++) {
          try {
            const found: unknown = Reflect.apply(TABLES[i]![key]!.get!, value, []);
            if (typeof found === "string") return found;
          } catch {}
        }
        return undefined;
      }
      export function copy(value: object) {
        return text(value, "name") + ": " + text(value, "message");
      }`,
      "text.test.ts": `
      import { expect, test } from "bun:test";
      import { copy } from "./text.ts";
      test("it", () => {${proxyAbovePrototype}
        const thrown = [
          new DOMException("gone", "AbortError"),
          Object.setPrototypeOf(new DOMException("gone", "AbortError"), null),
          new Made(),
        ];
        expect(thrown.map(copy)).toEqual(["Error: ", "AbortError: gone", "undefined: undefined"]);
      });`,
    });
  },
);
