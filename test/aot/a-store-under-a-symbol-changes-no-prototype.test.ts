import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, told } from "./harness/commands";
import { test } from "./supported";

const symbolOfTheRun = `const symbol = Object.getOwnPropertySymbols({ [Symbol("first")]: 1, [Symbol("second")]: 2 })[process.argv.length > 5 ? 0 : 1];`;

const scenes: [name: string, does: string][] = [
  [
    "a function stored under a symbol is no prototype",
    `const object = { a: 1 };
     object[symbol] = function named() { return "called"; };
     console.log(Object.getPrototypeOf(object) === Object.prototype, typeof object.call, typeof object.bind, object[symbol](), "call" in object);`,
  ],
  [
    "an object stored under a symbol is no prototype",
    `const object = { a: 1 };
     object[symbol] = { inherited: "from above" };
     console.log(Object.getPrototypeOf(object) === Object.prototype, object.inherited, object[symbol].inherited);`,
  ],
  [
    "a store under the text __proto__ of the run still is one",
    `const object = { a: 1 };
     const name = ["__proto__", "other"][process.argv.length > 5 ? 1 : 0];
     object[name] = { inherited: "from above" };
     console.log(Object.getPrototypeOf(object) === Object.prototype, object.inherited);`,
  ],
  [
    "a key that is a symbol or the text __proto__",
    `const object = { a: 1 };
     const key = [symbol, "__proto__"][process.argv.length > 5 ? 0 : 1];
     object[key] = { inherited: "from above" };
     console.log(Object.getPrototypeOf(object) === Object.prototype, object.inherited);`,
  ],
  [
    "the setter of __proto__ defined anew under the symbol",
    `const above = {};
     Object.defineProperty(above, symbol, Object.getOwnPropertyDescriptor(Object.prototype, "__proto__"));
     const object = Object.create(above);
     object[symbol] = { inherited() { return "from the new prototype"; } };
     console.log(Object.getPrototypeOf(object) === above, object.inherited?.());`,
  ],
  [
    "a setter of the program under the symbol",
    `const seen = [];
     const above = { set [symbol](value) { seen.push(value()); } };
     const object = Object.create(above);
     object[symbol] = () => "handed to the setter";
     console.log(seen.join(), Object.hasOwn(object, symbol));`,
  ],
  [
    "a key that is a symbol or undefined",
    `const object = { a: 1 };
     const key = Object.getOwnPropertySymbols({ [Symbol("only")]: 1 })[process.argv.length > 5 ? 0 : 1];
     object[key] = () => "under the text undefined";
     console.log(Object.keys(object).join(), object.undefined(), Object.getPrototypeOf(object) === Object.prototype);`,
  ],
  [
    "Reflect.set under a symbol",
    `const object = { a: 1 };
     console.log(Reflect.set(object, symbol, function () {}), Object.getPrototypeOf(object) === Object.prototype, typeof object.apply);`,
  ],
];

test.concurrent.each(scenes)(
  "%s",
  async (name, does) => {
    using dir = tempDir("aot-store-under-a-symbol", { "main.mjs": `${symbolOfTheRun}\n${does}\n` });
    const folder = String(dir);
    const executable = join(folder, isWindows ? "main.exe" : "main");
    await slot(async () => {
      built(
        await spawned([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable], folder, bunEnv),
      );
      expect(told(await spawned([executable], folder, bunEnv))).toEqual(
        told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv)),
      );
    });
  },
  240_000,
);

const proxy = `
const symbol = Symbol(process.argv[2]);
const values = { A: "a" };
values[symbol] = () => ({ ...values });
values.toJSON = () => ({ ...values });
const proxy = new Proxy(values, {
  get(target, key) { if (typeof key !== "string") return values[key]; const upper = key.toUpperCase(); if (upper in values) return values[upper]; return values[key]; },
  ownKeys() { return ["A"]; },
  getOwnPropertyDescriptor(target, key) { return Reflect.getOwnPropertyDescriptor(target, key); },
  defineProperty(target, key, descriptor) { values[key] = String(descriptor.value); return true; },
});`;
for (const [what, text] of Object.entries({
  "a method that the proxy inherits": `console.log(proxy.hasOwnProperty("A") === true);`,
  "JSON.stringify": `console.log(JSON.stringify(proxy));`,
}))
  test.concurrent(`${what}, with a function under a new symbol on the target, gives no trap away`, async () => {
    using dir = tempDir("aot-store-under-a-symbol-report", { "main.js": `${proxy}\n${text}\n` });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = (stdout + stderr).split("\n");
    expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
    expect(lines.filter(line => line.endsWith("(escapes, so any member may be used)")).length).toBeLessThanOrEqual(20);
  });
