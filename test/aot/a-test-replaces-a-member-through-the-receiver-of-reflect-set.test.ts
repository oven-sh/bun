import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

// The cases share the layers below them, so each writes on an object of its own and none puts a member back by a store.
const project = casesOfOneRun(
  "a-test-replaces-a-member-through-the-receiver-of-reflect-set",
  { "package.json": `{ "name": "p", "type": "module" }` },
  [[[]], [["--debug-aot"], "TestRunLayers:2"], [["--debug-aot"], "TestRunLayers:0"]],
);

function runsAsPlain(title: string, expected: string, body: string) {
  const name = project.add(
    name => `
      import { test } from "bun:test";
      ${sayOf(name)}
      const replaced = () => "replaced";
      test("${name}", () => {
        try {
          ${body}
        } catch (error) {
          say("threw", error.name);
        }
      });`,
  );
  test(title, async () => {
    const plain = (await project.ran()).get(name);
    expect(plain?.printed).toBe(expected + "\n");
    expect((await project.ran(["--debug-aot"], "TestRunLayers:2")).get(name)).toEqual(plain);
    expect((await project.ran(["--debug-aot"], "TestRunLayers:0")).get(name)).toEqual(plain);
  });
}

runsAsPlain(
  "Reflect.set({}, name, value, process) defines a number and a function",
  "true 7 true replaced",
  `say(Reflect.set({}, "pid", 7, process), process.pid, Reflect.set({}, "cwd", replaced, process), process.cwd());`,
);

runsAsPlain(
  "Reflect.set({}, name, value, globalThis) replaces a global function",
  "true true replaced",
  `say(Reflect.set({}, "escape", replaced, globalThis), escape === replaced, escape("a b"));`,
);

runsAsPlain(
  "Reflect.set({}, name, value, Math) replaces a function of the language",
  "true replaced",
  `say(Reflect.set({}, "hypot", replaced, Math), Math.hypot(3, 4));`,
);

runsAsPlain(
  "the name is made while the test runs",
  "true replaced",
  `say(Reflect.set({}, ["lo", "ad"].join(""), replaced, Atomics), Atomics.load());`,
);

runsAsPlain(
  "a receiver that is another object leaves the target as it was",
  "true false replaced",
  `const other = {};
          say(Reflect.set(Array, "of", replaced, other), Array.of === replaced, other.of());`,
);

runsAsPlain(
  "a trap hands Reflect.set its target as the receiver",
  "true replaced",
  `const proxy = new Proxy(performance, { set: (target, name, value) => Reflect.set(target, name, value, target) });
          say((proxy.now = replaced) === replaced, performance.now());`,
);

runsAsPlain(
  "a trap hands Reflect.set the receiver that it got",
  "true replaced",
  `const proxy = new Proxy(Date, { set: (target, name, value, receiver) => Reflect.set(target, name, value, receiver) });
          say((proxy.UTC = replaced) === replaced, Date.UTC());`,
);

runsAsPlain(
  "a trap stores on its target",
  "true replaced",
  `const proxy = new Proxy(String, { set: (target, name, value) => ((target[name] = value), true) });
          say((proxy.raw = replaced) === replaced, String.raw());`,
);

runsAsPlain(
  "a store on a proxy without traps",
  "true replaced",
  `const proxy = new Proxy(Number, {});
          say((proxy.isSafeInteger = replaced) === replaced, Number.isSafeInteger(1));`,
);

runsAsPlain(
  "Reflect.set() with a proxy of its target as the receiver",
  "true replaced",
  `say(Reflect.set(JSON, "rawJSON", replaced, new Proxy(JSON, {})), JSON.rawJSON("1"));`,
);

runsAsPlain(
  "Object.defineProperty() on a proxy",
  "replaced",
  `Object.defineProperty(new Proxy(Symbol, {}), "keyFor", { value: replaced, configurable: true, writable: true });
          say(Symbol.keyFor());`,
);

runsAsPlain("delete on a proxy", "true undefined", `say(delete new Proxy(BigInt, {}).asIntN, typeof BigInt.asIntN);`);
