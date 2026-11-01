// A test may replace a built-in function before it loads a module of Bun's, and then it sees every call the module makes while it
// loads. The second text of a module (src/js/ahead-of-time), which the compiler reads, has to make the calls of the first.
import { Glob } from "bun";
import { expect } from "bun:test";
import { join } from "path";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

const project = casesOfOneRun("a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads", {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": "{}",
});

// A compiled test replaces only what it spells out.
const holders = {
  Object,
  Reflect,
  Symbol,
  Array,
  Number,
  Math,
  JSON,
  String,
  Promise,
  BigInt,
  Date,
  ArrayBuffer,
  Proxy,
};
const functions: string[] = [];
for (const [holder, object] of Object.entries(holders)) {
  for (const [name, { value, writable }] of Object.entries(Object.getOwnPropertyDescriptors(object))) {
    if (typeof value === "function" && writable) functions.push(`${holder}.${name}`);
  }
}

function makesTheCallsOfPlainBun(module: string) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      ${sayOf(name)}
      test("${name}", () => {
        const apply = Reflect.apply, ownKeys = Reflect.ownKeys, stringify = JSON.stringify;
        const describe = value => {
          if (typeof value === "function") return "function " + value.name;
          if (typeof value === "symbol") return value.toString();
          if (typeof value !== "object" || value === null) return stringify(value) ?? "undefined";
          return "{" + ownKeys(value).map(key => key.toString()).join(",") + "}";
        };
        const calls = [];
        let isWatching = false;
        const watch = (name, real) => function (...all) {
          if (isWatching) {
            isWatching = false;
            calls.push(name + "(" + all.map(describe).join(", ") + ")");
            isWatching = true;
          }
          return apply(real, this, all);
        };
        ${functions.map((path, i) => `const real${i} = ${path}; ${path} = watch("${path}", real${i});`).join("\n        ")}
        isWatching = true;
        try {
          require("${module}");
        } finally {
          isWatching = false;
          ${functions.map((path, i) => `${path} = real${i};`).join("\n          ")}
        }
        for (const call of calls) say(call);
      });`,
  );
  test(module, async () => {
    const plain = (await project.ran()).get(name)!;
    expect(plain.result).toBe("pass");
    expect(plain.printed).not.toBe("");
    expect((await project.ran(["--debug-aot"])).get(name)).toEqual(plain);
  });
}

const secondTexts = [...new Glob("node/*.ts").scanSync({ cwd: join(import.meta.dir, "../../src/js/ahead-of-time") })]
  .map(file => "node:" + file.replaceAll("\\", "/").slice("node/".length, -".ts".length))
  .sort();

test("node:http has a second text", () => {
  expect(secondTexts).toContain("node:http");
});

// The last three load texts that a program cannot name: internal/http alone, internal/primordials, a stream with events of its own.
for (const module of [...secondTexts, "node:http2", "node:util", "node:test"]) makesTheCallsOfPlainBun(module);
