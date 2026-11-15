// A built-in that is handed a proxy runs the traps of its handler, however the call is written: with the operands as they stand, out of
// a list that is spread, through apply or Reflect.apply, behind a rest parameter, with its answer used or not. Each scene has a proxy and
// a handler of its own, so that what one scene does to its proxy says nothing of another's.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, told } from "./harness/commands";
import { test } from "./supported";

const ways: [string, (callee: string, holder: string, operands: string) => string][] = [
  ["plain", (callee, _, operands) => `${callee}(${operands})`],
  ["spread", (callee, _, operands) => `${callee}(...[${operands}])`],
  ["list", (callee, _, operands) => `const list = [${operands}]; ${callee}(...list)`],
  ["mixed", (callee, _, operands) => `${callee}(${operands}, ...[])`],
  ["rest", (callee, _, operands) => `((...list) => ${callee}(...list))(${operands})`],
  ["apply", (callee, holder, operands) => `${callee}.apply(${holder}, [${operands}])`],
  ["reflect", (callee, holder, operands) => `Reflect.apply(${callee}, ${holder}, [${operands}])`],
  ["typeof", (callee, _, operands) => `typeof ${callee}(...[${operands}])`],
  ["used", (callee, _, operands) => `seen.push(typeof ${callee}(...[${operands}]))`],
];

const described = `{ value: 1, configurable: true }`;
const calls: [string, string][] = [
  ...["keys", "values", "entries", "getOwnPropertyNames", "getOwnPropertySymbols", "getOwnPropertyDescriptors"],
  ...["getPrototypeOf", "isExtensible", "preventExtensions", "isFrozen", "isSealed", "freeze", "seal", "create"],
]
  .map((name): [string, string] => [`Object.${name}`, "proxy"])
  .concat(
    ["ownKeys", "getPrototypeOf", "isExtensible", "preventExtensions"].map(name => [`Reflect.${name}`, "proxy"]),
    ["get", "has", "deleteProperty", "getOwnPropertyDescriptor"].map(name => [`Reflect.${name}`, `proxy, "a"`]),
    [
      ["Object.getOwnPropertyDescriptor", `proxy, "a"`],
      ["Object.hasOwn", `proxy, "a"`],
      ["Object.setPrototypeOf", "proxy, null"],
      ["Object.defineProperty", `proxy, "a", ${described}`],
      ["Object.assign", "{}, proxy"],
      ["Object.assign", "proxy, { a: 1 }"],
      ["Reflect.set", `proxy, "a", 1`],
      ["Reflect.setPrototypeOf", "proxy, null"],
      ["Reflect.defineProperty", `proxy, "a", ${described}`],
      ["Array.isArray", "proxy"],
      ["Array.from", "proxy"],
      ["JSON.stringify", "proxy"],
      ["String", "proxy"],
      ["Promise.resolve", "proxy"],
    ],
  );

const traps = [
  ...["get", "set", "has", "deleteProperty", "ownKeys", "getOwnPropertyDescriptor", "defineProperty"],
  ...["getPrototypeOf", "setPrototypeOf", "isExtensible", "preventExtensions"],
];
const handler = `{ ${traps.map(trap => `${trap}(...list) { seen.push("${trap}"); return Reflect.${trap}(...list); }`).join(", ")} }`;

const program = `
const lines = [];
function scene(name, run) {
  const seen = [];
  let ended = "returned";
  try {
    run(seen);
  } catch (error) {
    ended = error.constructor.name;
  }
  lines.push([name, seen, ended]);
}
${calls
  .flatMap(([callee, operands]) =>
    ways.map(
      ([way, write]) =>
        `scene("${callee} ${way}", seen => { const proxy = new Proxy({ a: 1 }, ${handler}); ${write(callee, callee.includes(".") ? callee.split(".")[0] : "undefined", operands)}; });`,
    ),
  )
  .join("\n")}
await 0;
for (const [name, seen, ended] of lines) console.log(name, ended, seen.join(" "));
`;

test("a built-in runs the traps of a proxy that it is handed, however the call is written", async () => {
  using dir = tempDir("aot-ways-to-call-a-built-in", { "main.mjs": program });
  const folder = String(dir);
  const executable = join(folder, isWindows ? "main.exe" : "main");
  await slot(async () => {
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable], folder, bunEnv),
    );
    const plain = told(await spawned([bunExe(), "./main.mjs"], folder, bunEnv));
    expect(plain.stdout.split("\n").length).toBeGreaterThan(calls.length * ways.length);
    expect(told(await spawned([executable], folder, bunEnv))).toEqual(plain);
  });
}, 240_000);
