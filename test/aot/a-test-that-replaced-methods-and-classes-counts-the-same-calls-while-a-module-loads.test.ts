// A test may replace a method of a built-in prototype, or lay a class of its own in the place of a built-in one, before it loads a
// module of Bun's, and count the calls that the module makes while it loads. `bun test --aot` is held to the counts of `bun test`.
// The static functions are held call by call: a-test-that-replaced-built-in-functions-sees-the-same-calls-while-a-module-loads.test.ts.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const methods = {
  "Array.prototype":
    "slice push pop shift unshift splice map filter forEach join concat indexOf includes sort reduce some every find fill keys values entries",
  "Function.prototype": "bind call apply toString",
  "Object.prototype": "hasOwnProperty isPrototypeOf propertyIsEnumerable toString valueOf",
  "String.prototype":
    "startsWith endsWith split slice toLowerCase toUpperCase trim replace indexOf includes charCodeAt padStart repeat",
  "RegExp.prototype": "test exec",
  "Map.prototype": "set get has delete forEach",
  "Set.prototype": "add has delete forEach",
  "WeakMap.prototype": "set get has",
  "Promise.prototype": "then catch finally",
};
const classes = ["Symbol", "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Promise", "Array"];
const modules = [
  ..."events async_hooks stream fs path net tty _http_common _http_incoming _http_outgoing _http_agent _http_client _http_server http https http2 tls zlib crypto child_process worker_threads readline url querystring assert os dns dgram timers perf_hooks vm util test"
    .split(" ")
    .map(name => "node:" + name),
  "bun:ffi",
];

// A pair that comes to agree turns this test red: take it out of its list.
const differs = {
  "`require` of `bun test` asks the name that it is handed (src/js/builtins/CommonJS.ts), and the build has bound a compiled one":
    [
      ...modules.map(module => `${module}: String.prototype.startsWith`),
      "bun:ffi: String.prototype.endsWith",
      "bun:ffi: String.prototype.indexOf",
    ],
  "the texts that the compiler reads make another number of symbols while these load": [
    "node:_http_common: Symbol",
    "node:_http_outgoing: Symbol",
  ],
  "the second text of internal/primordials is written out, where the first goes through the members of each class": [
    "node:stream: Function.prototype.bind",
    "node:stream: Function.prototype.call",
    "node:stream: Object.prototype.hasOwnProperty",
  ],
  "the functions of node:fs that node:net calls are written out for a compiled program, where `bun test` binds them": [
    "node:fs: Function.prototype.bind",
  ],
  "the first texts of node:util and of internal/util/inspect, which loads with node:test, uncurry methods by `bind` (internal/primordials); the second texts are written out":
    ["node:test: Function.prototype.bind", "node:util: Function.prototype.bind"],
};

// A compiled test replaces only what it spells out. What stands in has the length and the name of what it stands for:
// internal/primordials calls every method that takes no argument.
const counters = `const apply = Reflect.apply, construct = Reflect.construct, setPrototypeOf = Object.setPrototypeOf, defineProperty = Object.defineProperty;
const counts = Object.create(null);
const state = { watching: false };
const like = (watcher, real) => {
  defineProperty(watcher, "length", { value: real.length, configurable: true });
  defineProperty(watcher, "name", { value: real.name, configurable: true });
  return watcher;
};
function wrap(name, real) {
  counts[name] = 0;
  return like(function (...all) {
    if (state.watching) counts[name]++;
    return apply(real, this, all);
  }, real);
}
function wrapClass(name, real) {
  counts[name] = 0;
  const watcher = function (...all) {
    if (state.watching) counts[name]++;
    return new.target ? construct(real, all, new.target === watcher ? real : new.target) : apply(real, this, all);
  };
  setPrototypeOf(watcher, real);
  watcher.prototype = real.prototype;
  return like(watcher, real);
}
globalThis.madeUpCounts = { counts, state };
${Object.entries(methods)
  .flatMap(([holder, names]) => names.split(" ").map(name => `${holder}.${name}`))
  .map(path => `${path} = wrap("${path}", ${path});`)
  .join("\n")}
${classes.map(name => `globalThis.${name} = wrapClass("${name}", ${name});`).join("\n")}
`;

const asks = `import { test } from "bun:test";
const modules = [
${modules.map(module => `  ["${module}", () => require("${module}")],`).join("\n")}
];
test("t", () => {
  const { counts, state } = madeUpCounts;
  let said = "";
  for (const [name, load] of modules) {
    const before = {};
    for (const key in counts) before[key] = counts[key];
    let thrown = "";
    state.watching = true;
    try { load(); } catch (error) { state.watching = false; thrown = " thrown"; }
    state.watching = false;
    said += "SAID " + name;
    for (const key in counts) if (counts[key] !== before[key]) said += " " + key + "=" + (counts[key] - before[key]);
    said += thrown + "\\n";
  }
  console.error(said);
});
`;

test("a test that replaced methods and classes counts the same calls while a module loads", async () => {
  using dir = tempDir("aot-counts-while-a-module-loads", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "counters.js": counters,
    "a.test.js": asks,
  });
  const countedWith = async (...flags: string[]) => {
    const cmd = [bunExe(), "test", "--preload", "./counters.js", ...flags];
    const { stdout, stderr, exitCode } = await run(cmd, String(dir), bunEnv);
    expect(exitCode).toBe(0);
    const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SAID "));
    expect(lines.filter(line => line.endsWith(" thrown"))).toEqual([]);
    const counted = new Map(lines.map(line => line.split(" ").slice(1)).map(([module, ...pairs]) => [module, pairs]));
    expect([...counted.keys()]).toEqual(modules);
    return counted;
  };
  const plain = await countedWith();
  const compiled = await countedWith("--aot");

  // A run that counts nothing says nothing.
  for (const counted of [plain, compiled]) {
    expect(counted.get("node:events")!.some(pair => pair.startsWith("Symbol="))).toBe(true);
    expect(new Set([...counted.values()].flat().map(pair => pair.split("=")[0])).size).toBeGreaterThan(12);
  }

  const found: string[] = [];
  for (const module of modules) {
    const [one, other] = [plain, compiled].map(counted => new Set(counted.get(module)!));
    for (const name of new Set([...one.symmetricDifference(other)].map(pair => pair.split("=")[0])))
      found.push(`${module}: ${name}`);
  }
  expect(found.sort()).toEqual(Object.values(differs).flat().sort());
});
