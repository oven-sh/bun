// A class of the table of built-ins either lists the own names of its instances (`namesDefinedOnNewInstances`, an empty list too) or says nothing (null). Where it lists them, and every class
// whose prototype object lies above its own does, the compiler takes a read that finds nothing on an instance for `undefined`. Where one of them says nothing, the read answers a value nobody knows.
// So a list is held to what it says, however the instance is made. the-table-of-built-ins-lists-the-own-names-of-new-instances.test.ts constructs each class. Here an instance is made by a class of
// the program below it, by Reflect.construct() for another new.target, by the operations of the language that make one without a call, and by the calls that no table of operands finds.
import { expect } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";
import { findBuiltinTable } from "./harness/builtin-table";
import { test } from "./supported";

const table = findBuiltinTable(bunExe());

const script = `
const table = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const classes = new Map(table.classes.map(entry => [entry.token, entry]));
const entries = new Map(table.entries.map(entry => [entry.token, entry]));
const classOfPrototype = new Map(table.classes.filter(entry => entry.prototype).map(entry => [entry.prototype, entry]));
const spell = (name, isSymbol) => (isSymbol ? "@@" + name : name);
const membersOfInstances = new Map();
for (const entry of table.entries) {
  if (!entry.flags.includes("IsOwnPropertyOfInstances") || !entry.holder) continue;
  if (!membersOfInstances.has(entry.holder)) membersOfInstances.set(entry.holder, []);
  membersOfInstances.get(entry.holder).push(spell(entry.name, entry.isSymbolName));
}
// The classes whose prototype objects an instance has above it, from its own class up. Undefined where the table does not know the whole chain.
function classesAbove(builtinClass) {
  const above = [];
  for (let prototype = builtinClass.prototype; prototype; ) {
    const entry = entries.get(prototype);
    if (classOfPrototype.has(prototype)) above.push(classOfPrototype.get(prototype));
    if (entry.prototypeLink === "Unknown") return undefined;
    prototype = entry.prototypeLink === "Builtin" ? entry.inheritsFrom : null;
  }
  return above;
}
function listedFor(builtinClass) {
  const above = builtinClass.prototype ? classesAbove(builtinClass) : undefined;
  if (above === undefined || above.some(entry => entry.namesDefinedOnNewInstances === null)) return undefined;
  const names = new Set();
  for (const entry of above) {
    for (const name of entry.namesDefinedOnNewInstances) names.add(name);
    for (const name of membersOfInstances.get(entry.prototype) ?? []) names.add(name);
  }
  return names;
}
function reach(path) {
  let value = globalThis;
  for (const part of path.split(".")) value = value?.[part];
  return value;
}
const found = { below: 0, forAnotherTarget: 0, byTheLanguage: 0, byOneCall: 0, listing: 0, notListed: [] };
function hold(how, builtinClass, listed, instance) {
  const others = Reflect.ownKeys(instance)
    .map(key => (typeof key === "symbol" ? "@@" + String(key.description).replace(/^Symbol\\./, "") : key))
    .filter(name => !/^\\d+$/.test(name) && !listed.has(name));
  if (others.length) found.notListed.push(builtinClass.token + " " + how + ": " + others.join(" "));
}
const operands = [[], ["x"], [1], [{}], ["x", {}], [new ArrayBuffer(8)], [() => {}], [[]], ["http://a.b/c"], [["x"], "n"], [{}, {}], ["a", "b"], [new Uint8Array(8)], ["sha1"], ["*"]];
function make(construct) {
  for (const passed of operands) {
    try {
      const instance = construct(passed);
      if (Object(instance) === instance) return instance;
    } catch {}
  }
}
for (const builtinClass of table.classes) {
  const listed = listedFor(builtinClass);
  if (listed === undefined) continue;
  found.listing++;
  const path = entries.get(builtinClass.constructor)?.path;
  if (path === undefined || /^(%|native:|node:|bun:)/.test(path)) continue;
  const constructor = reach(path);
  if (typeof constructor !== "function") continue;
  // What a function made from text has follows from its kind, and the compiler follows none.
  if (builtinClass.token === "Function") continue;
  let Below;
  try {
    Below = class extends constructor {};
  } catch {
    continue;
  }
  const below = make(passed => new Below(...passed));
  if (below !== undefined) {
    found.below++;
    hold("below", builtinClass, listed, below);
  }
  const forAnotherTarget = make(passed => Reflect.construct(constructor, passed, function () {}));
  if (forAnotherTarget !== undefined) {
    found.forAnotherTarget++;
    hold("for another new.target", builtinClass, listed, forAnotherTarget);
  }
}
// The script is no module and not strict: \`this\` of a call with a primitive is an object made of it.
function sloppyThis() {
  return this;
}
const byTheLanguage = {
  RegExp: [/x/g],
  Promise: [(async () => {})(), import("node:path")],
  Generator: [(function* () {})()],
  AsyncGenerator: [(async function* () {})()],
  String: [sloppyThis.call("xy")],
  Number: [sloppyThis.call(1)],
  Boolean: [sloppyThis.call(true)],
  Symbol: [sloppyThis.call(Symbol.iterator)],
  BigInt: [sloppyThis.call(1n)],
};
for (const [token, instances] of Object.entries(byTheLanguage)) {
  const listed = listedFor(classes.get(token));
  if (listed === undefined) continue;
  for (const instance of instances) {
    found.byTheLanguage++;
    hold("by the language", classes.get(token), listed, instance);
  }
}
const serve = options => {
  const server = Bun.serve({ port: 0, fetch: () => new Response(""), ...options });
  server.stop(true);
  return server;
};
const certificate = JSON.parse(process.argv[2]);
const byOneCall = {
  HTTPServer: () => serve({ development: false }),
  HTTPSServer: () => serve({ development: false, tls: certificate }),
  DebugHTTPServer: () => serve({ development: true }),
  DebugHTTPSServer: () => serve({ development: true, tls: certificate }),
  NodeJSFS: () => require("internal/fs/binding"),
  NetworkSink: () => new Bun.S3Client({ accessKeyId: "a", secretAccessKey: "b", bucket: "c", endpoint: "http://127.0.0.1:1" }).file("x").writer(),
};
for (const [token, call] of Object.entries(byOneCall)) {
  const listed = listedFor(classes.get(token));
  if (listed === undefined) continue;
  const instance = call();
  if (Object.prototype.toString.call(instance) !== "[object " + token + "]") found.notListed.push(token + " was not made");
  found.byOneCall++;
  hold("by one call", classes.get(token), listed, instance);
}
console.log(JSON.stringify(found));
process.exit(0);
`;

test.skipIf(table === undefined)(
  "a class that lists the own names of its instances lists them however an instance is made",
  () => {
    const { stdout, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "--expose-internals", "-e", script, table!, JSON.stringify(tls)],
      env: { ...bunEnv, BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1" },
      stdout: "pipe",
      stderr: "inherit",
    });
    const found = JSON.parse(stdout.toString()) as {
      below: number;
      forAnotherTarget: number;
      byTheLanguage: number;
      byOneCall: number;
      listing: number;
      notListed: string[];
    };
    expect(found.notListed).toEqual([]);
    expect(found.listing).toBeGreaterThan(100);
    expect(found.below).toBeGreaterThan(60);
    expect(found.forAnotherTarget).toBeGreaterThan(60);
    expect(found.byTheLanguage).toBe(10);
    expect(found.byOneCall).toBe(6);
    expect(exitCode).toBe(0);
  },
);
