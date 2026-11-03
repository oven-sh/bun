import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// A built-in function has a row for a pristine operand, which leaves out what a lookup on such an operand finds, and a general row. Where tests replace a member that the table locks,
// the first is passed by for the classes on whose instances a lookup finds the replaced member: Object.prototype.valueOf on an array, but not Object.prototype.toString, which
// Array.prototype.toString hides. Each run here replaces other members, by a function that notes the call and calls the original, and does the same with lists, bytes, maps, sets,
// patterns, dates, errors, functions and promises, made in a module of the project and in the test file: before, while and after the members are replaced. As plain Bun does it, call for call.
const rows = `
  const rows = [];
  const row = async (label, run) => { seen.length = 0; let answer; try { answer = String(await run()); } catch (error) { answer = error.name + ": " + error.message; } const calls = seen.slice(); rows.push(where + " | " + label + " | " + answer.replace(/GMT.*/, "GMT..") + " | " + calls.length + " " + [...new Set(calls)].sort().join(",")); };
  await row("numbers joined", () => [1, 2, 3].join("-"));
  await row("nested lists joined", () => [1, [2, 3], "x", [[4]]].join());
  await row("String(list)", () => String([1, 2]));
  await row("list in a template", () => \`\${[1, 2]}\`);
  await row("list + text", () => [1, 2] + "");
  await row("list.toString()", () => [1, 2].toString());
  await row("holes joined", () => [, 1, , ].join() + "|" + Array(3).join("x"));
  await row("objects joined", () => [{}, { a: 1 }].join());
  await row("functions joined", () => [function f() {}].join().length > 0);
  await row("numbers sorted", () => [3, 1, 2].sort().join());
  await row("texts sorted", () => ["b", "a"].sort().join());
  await row("objects sorted", () => [{}, [], {}].sort().length);
  await row("sorted by a function", () => [3, 1, 2].sort((a, b) => b - a).join());
  await row("slice", () => [1, 2, 3].slice(1).join());
  await row("map", () => [1, 2, 3].map(x => x * 2).join());
  await row("filter", () => [1, 2, 3].filter(x => x > 1).join());
  await row("concat", () => [1].concat([2], 3, [[4]]).join());
  await row("flat", () => [[1], [2, [3]]].flat().join());
  await row("indexOf includes", () => [1, 2, 3].indexOf(2) + " " + [1, 2].includes(2));
  await row("reverse splice", () => { const l = [1, 2, 3, 4]; l.reverse(); return l.splice(1, 2).join() + "|" + l.join(); });
  await row("push pop shift unshift", () => { const l = [1]; l.push(2, 3); l.pop(); l.unshift(0); l.shift(); return l.join(); });
  await row("spread of a list", () => [...[1, 2, 3]].join());
  await row("Array.from", () => Array.from([1, 2]).join() + "|" + Array.from({ length: 2 }, (_, i) => i).join());
  await row("a list pattern", () => { const [a, , b = 9] = [1, 2]; return a + " " + b; });
  await row("for of a list", () => { let s = 0; for (const x of [1, 2, 3]) s += x; return s; });
  await row("list stringified", () => JSON.stringify([1, "a", null, { b: 2 }, [3]]));
  await row("record stringified", () => JSON.stringify({ a: [1, 2], d: new Date(0), n: { m: 1 } }));
  await row("list.toLocaleString()", () => [1, "a"].toLocaleString());
  await row("list to a number", () => +[5] + " " + [5] * 2 + " " + ([1] == 1) + " " + ([1, 2] < [1, 3]));
  await row("bytes joined", () => new Uint8Array([1, 2, 3]).join("-"));
  await row("String(bytes)", () => String(new Uint8Array([1, 2])) + "|" + new Uint8Array([3]).toString() + "|" + \`\${new Float64Array([1.5])}\`);
  await row("bytes slice map", () => new Uint8Array([1, 2, 3]).slice(1).join() + "|" + new Uint8Array([1, 2]).map(x => x + 1).join());
  await row("spread of bytes", () => [...new Uint8Array([7, 8])].join());
  await row("bytes sorted", () => new Int16Array([3, -1, 2]).sort().join());
  await row("a map of pairs", () => new Map([[1, 2], [3, 4]]).size + " " + new Map(new Map([[1, 2]])).get(1));
  await row("spread of a map", () => [...new Map([[1, 2]])].join() + "|" + [...new Map([[1, 2]]).keys()].join());
  await row("String(map)", () => String(new Map()) + \`\${new Set()}\`);
  await row("a set of a list", () => new Set([1, 2, 2]).size + " " + new Set(new Set([1])).has(1));
  await row("spread of a set", () => [...new Set([3, 4])].join());
  await row("map get set has", () => { const m = new Map(); m.set("a", 1); return m.get("a") + " " + m.has("a") + " " + m.has("b"); });
  await row("replace by a pattern", () => "a-b-c".replace(/-/g, "+") + "|" + "aXbX".replaceAll(/X/g, "_"));
  await row("match search test", () => "abc".match(/b/)[0] + " " + "abc".search(/c/) + " " + /x/.test("x"));
  await row("split by a pattern", () => "a1b2c".split(/\\d/).join());
  await row("matchAll", () => [..."a1b2".matchAll(/\\d/g)].length);
  await row("String(pattern)", () => String(/a/g) + \`\${/b/}\`);
  await row("String(date)", () => String(new Date(0)));
  await row("date to a number", () => +new Date(5) + " " + (new Date(7) - new Date(2)));
  await row("String(error)", () => \`\${new Error("e")}\` + "|" + String(new TypeError("t")));
  await row("String(function)", () => String(function g() {}).length > 0);
  await row("String(record)", () => String({}) + "|" + \`\${{}}\` + "|" + ({} + ""));
  await row("Object.prototype.toString.call", () => Object.prototype.toString.call([]) + Object.prototype.toString.call(null) + Object.prototype.toString.call(new Date(0)));
  await row("record to a number", () => +{} + " " + ({}).valueOf().constructor.name);
  await row("wrappers", () => String(new String("s")) + (new Number(5) + 1) + \`\${new Boolean(true)}\`);
  await row("Promise.all", async () => (await Promise.all([1, Promise.resolve(2)])).join());
  await row("await", async () => (await Promise.resolve(3)) + (await (async () => 4)()) + (await 5));
  await row("Promise.race then", async () => (await Promise.race([6])) + " " + (await Promise.resolve(1).then(x => x + 1)));
  await row("Object.keys entries assign", () => Object.keys({ a: 1, b: 2 }).join() + "|" + Object.entries({ a: 1 }).join() + "|" + JSON.stringify(Object.assign({}, { c: 3 })));
  await row("text methods", () => " x ".trim() + "abc".at(1) + "abc".slice(1) + "a,b".split(",").join("") + "ab".padStart(3, "-"));
  return rows;
`;

const replacements: Record<string, string> = {
  "object-and-function-tostring": `
  const original1 = Object.prototype.toString;
  Object.prototype.toString = function (...operands) { seen[seen.length] = "Object.toString"; return original1.apply(this, operands); };
  undo[undo.length] = () => { Object.prototype.toString = original1; };
  const original2 = Function.prototype.toString;
  Function.prototype.toString = function (...operands) { seen[seen.length] = "Function.toString"; return original2.apply(this, operands); };
  undo[undo.length] = () => { Function.prototype.toString = original2; };`,
  "object-valueof": `
  const original3 = Object.prototype.valueOf;
  Object.prototype.valueOf = function (...operands) { seen[seen.length] = "Object.valueOf"; return original3.apply(this, operands); };
  undo[undo.length] = () => { Object.prototype.valueOf = original3; };`,
  "array-join": `
  const original4 = Array.prototype.join;
  Array.prototype.join = function (...operands) { seen[seen.length] = "Array.join"; return original4.apply(this, operands); };
  undo[undo.length] = () => { Array.prototype.join = original4; };`,
  "array-tostring": `
  const original5 = Array.prototype.toString;
  Array.prototype.toString = function (...operands) { seen[seen.length] = "Array.toString"; return original5.apply(this, operands); };
  undo[undo.length] = () => { Array.prototype.toString = original5; };`,
  "names-opened-on-object-prototype": `
  Object.prototype.format = function () { seen[seen.length] = "format"; return "formatted"; };
  undo[undo.length] = () => { delete Object.prototype.format; };
  Object.prototype.toJSON = function () { seen[seen.length] = "toJSON"; return "json"; };
  undo[undo.length] = () => { delete Object.prototype.toJSON; };`,
  "promise-then": `
  const original16 = Promise.prototype.then;
  Promise.prototype.then = function (...operands) { seen[seen.length] = "Promise.then"; return original16.apply(this, operands); };
  undo[undo.length] = () => { Promise.prototype.then = original16; };`,
  "date-and-error-tostring": `
  const original26 = Date.prototype.toString;
  Date.prototype.toString = function (...operands) { seen[seen.length] = "Date.toString"; return original26.apply(this, operands); };
  undo[undo.length] = () => { Date.prototype.toString = original26; };
  const original27 = Error.prototype.toString;
  Error.prototype.toString = function (...operands) { seen[seen.length] = "Error.toString"; return original27.apply(this, operands); };
  undo[undo.length] = () => { Error.prototype.toString = original27; };
  const original28 = Date.prototype.toJSON;
  Date.prototype.toJSON = function (...operands) { seen[seen.length] = "Date.toJSON"; return original28.apply(this, operands); };
  undo[undo.length] = () => { Date.prototype.toJSON = original28; };
  const original29 = Date.prototype.valueOf;
  Date.prototype.valueOf = function (...operands) { seen[seen.length] = "Date.valueOf"; return original29.apply(this, operands); };
  undo[undo.length] = () => { Date.prototype.valueOf = original29; };`,
  "regexp-exec": `
  const original10 = RegExp.prototype.exec;
  RegExp.prototype.exec = function (...operands) { seen[seen.length] = "RegExp.exec"; return original10.apply(this, operands); };
  undo[undo.length] = () => { RegExp.prototype.exec = original10; };`,
  "map-set-and-set-add": `
  const original11 = Map.prototype.set;
  Map.prototype.set = function (...operands) { seen[seen.length] = "Map.set"; return original11.apply(this, operands); };
  undo[undo.length] = () => { Map.prototype.set = original11; };
  const original12 = Set.prototype.add;
  Set.prototype.add = function (...operands) { seen[seen.length] = "Set.add"; return original12.apply(this, operands); };
  undo[undo.length] = () => { Set.prototype.add = original12; };`,
  "statics-and-globals": `
  const original21 = Date.now;
  Date.now = function (...operands) { seen[seen.length] = "Date.now"; return original21.apply(this, operands); };
  undo[undo.length] = () => { Date.now = original21; };
  const original22 = Math.random;
  Math.random = function (...operands) { seen[seen.length] = "Math.random"; return original22.apply(this, operands); };
  undo[undo.length] = () => { Math.random = original22; };
  const original23 = JSON.parse;
  JSON.parse = function (...operands) { seen[seen.length] = "JSON.parse"; return original23.apply(this, operands); };
  undo[undo.length] = () => { JSON.parse = original23; };
  const original24 = Object.keys;
  Object.keys = function (...operands) { seen[seen.length] = "Object.keys"; return original24.apply(this, operands); };
  undo[undo.length] = () => { Object.keys = original24; };
  const original25 = globalThis.setTimeout;
  globalThis.setTimeout = function (...operands) { seen[seen.length] = "setTimeout"; return original25.apply(this, operands); };
  undo[undo.length] = () => { globalThis.setTimeout = original25; };`,
};

for (const [name, replacement] of Object.entries(replacements)) {
  test.concurrent(`built-in functions on what the program makes, where tests replace ${name}`, async () => {
    using dir = tempDir("tests-replace-" + name, {
      "package.json": `{ "name": "p", "type": "module" }`,
      "tsconfig.json": "{}",
      "src/log.js": "export const seen = [];\n",
      "src/uses.js": `import { seen } from "./log.js";\nexport async function uses(where) {${rows}}\n`,
      "a.test.js": `
        import { test } from "bun:test";
        import { seen } from "./src/log.js";
        import { uses } from "./src/uses.js";
        async function usesHere(where) {${rows}}
        const undo = [];
        test("a", async () => {
          const lines = [...await uses("before src"), ...await usesHere("before test file")];
          ${replacement}
          const replaced = [...await uses("replaced src"), ...await usesHere("replaced test file")];
          while (undo.length) undo.pop()();
          lines.push(...replaced, ...await uses("restored src"), ...await usesHere("restored test file"));
          process.stdout.write(lines.join("\\n") + "\\n");
        }, 60000);`,
      "z.test.js": `import { test } from "bun:test";\ntest("z", () => {});\n`,
    });
    const seen = async (env: Record<string, string | undefined>, ...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), {
        ...env,
        TZ: "UTC",
      });
      if (exitCode !== 0) console.error(stderr);
      return { exitCode, lines: stdout.split("\n").filter(line => line.includes(" | ")) };
    };
    const plain = await seen(bunEnv);
    expect(plain.exitCode).toBe(0);
    expect(plain.lines.length).toBe(348);
    expect(await seen(bunEnv, "--aot")).toEqual(plain);
    expect(await seen({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }, "--aot")).toEqual(
      plain,
    );
  });
}
