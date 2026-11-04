import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

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

// What a row answers in plain Bun while nothing is replaced, in the order of the rows.
const answers: Record<string, string> = {
  "numbers joined": "1-2-3",
  "nested lists joined": "1,2,3,x,4",
  "String(list)": "1,2",
  "list in a template": "1,2",
  "list + text": "1,2",
  "list.toString()": "1,2",
  "holes joined": ",1,|xx",
  "objects joined": "[object Object],[object Object]",
  "functions joined": "true",
  "numbers sorted": "1,2,3",
  "texts sorted": "a,b",
  "objects sorted": "3",
  "sorted by a function": "3,2,1",
  "slice": "2,3",
  "map": "2,4,6",
  "filter": "2,3",
  "concat": "1,2,3,4",
  "flat": "1,2,3",
  "indexOf includes": "1 true",
  "reverse splice": "3,2|4,1",
  "push pop shift unshift": "1,2",
  "spread of a list": "1,2,3",
  "Array.from": "1,2|0,1",
  "a list pattern": "1 9",
  "for of a list": "6",
  "list stringified": '[1,"a",null,{"b":2},[3]]',
  "record stringified": '{"a":[1,2],"d":"1970-01-01T00:00:00.000Z","n":{"m":1}}',
  "list.toLocaleString()": "1,a",
  "list to a number": "5 10 true true",
  "bytes joined": "1-2-3",
  "String(bytes)": "1,2|3|1.5",
  "bytes slice map": "2,3|2,3",
  "spread of bytes": "7,8",
  "bytes sorted": "-1,2,3",
  "a map of pairs": "2 2",
  "spread of a map": "1,2|1",
  "String(map)": "[object Map][object Set]",
  "a set of a list": "2 true",
  "spread of a set": "3,4",
  "map get set has": "1 true false",
  "replace by a pattern": "a+b+c|a_b_",
  "match search test": "b 2 true",
  "split by a pattern": "a,b,c",
  "matchAll": "2",
  "String(pattern)": "/a/g/b/",
  "String(date)": "Thu Jan 01 1970 00:00:00 GMT..",
  "date to a number": "5 5",
  "String(error)": "Error: e|TypeError: t",
  "String(function)": "true",
  "String(record)": "[object Object]|[object Object]|[object Object]",
  "Object.prototype.toString.call": "[object Array][object Null][object Date]",
  "record to a number": "NaN Object",
  "wrappers": "s6true",
  "Promise.all": "1,2",
  "await": "12",
  "Promise.race then": "6 2",
  "Object.keys entries assign": 'a,b|a,1|{"c":3}',
  "text methods": "xbbcab-ab",
};

type Case = {
  /** What the test runs between the rows to replace the members. Each replacement lists what undoes it. */
  replaces: string;
  /** The rows that call a replaced member in plain Bun: how many calls, and of which members. Every other row makes none. */
  calls: Record<string, string>;
  /** The rows that answer something else while the members are replaced. */
  answers?: Record<string, string>;
};

const cases: Record<string, Case> = {
  "object-and-function-tostring": {
    replaces: `
  const original1 = Object.prototype.toString;
  Object.prototype.toString = function (...operands) { seen[seen.length] = "Object.toString"; return original1.apply(this, operands); };
  undo[undo.length] = () => { Object.prototype.toString = original1; };
  const original2 = Function.prototype.toString;
  Function.prototype.toString = function (...operands) { seen[seen.length] = "Function.toString"; return original2.apply(this, operands); };
  undo[undo.length] = () => { Function.prototype.toString = original2; };`,
    calls: {
      "objects joined": "2 Object.toString",
      "functions joined": "1 Function.toString",
      "objects sorted": "2 Object.toString",
      "String(map)": "2 Object.toString",
      "String(function)": "1 Function.toString",
      "String(record)": "3 Object.toString",
      "Object.prototype.toString.call": "3 Object.toString",
      "record to a number": "1 Object.toString",
    },
  },
  "object-valueof": {
    replaces: `
  const original3 = Object.prototype.valueOf;
  Object.prototype.valueOf = function (...operands) { seen[seen.length] = "Object.valueOf"; return original3.apply(this, operands); };
  undo[undo.length] = () => { Object.prototype.valueOf = original3; };`,
    calls: {
      "list + text": "1 Object.valueOf",
      "list to a number": "5 Object.valueOf",
      "String(record)": "1 Object.valueOf",
      "record to a number": "2 Object.valueOf",
    },
  },
  "array-join": {
    replaces: `
  const original4 = Array.prototype.join;
  Array.prototype.join = function (...operands) { seen[seen.length] = "Array.join"; return original4.apply(this, operands); };
  undo[undo.length] = () => { Array.prototype.join = original4; };`,
    calls: {
      "numbers joined": "1 Array.join",
      "nested lists joined": "4 Array.join",
      "String(list)": "1 Array.join",
      "list in a template": "1 Array.join",
      "list + text": "1 Array.join",
      "list.toString()": "1 Array.join",
      "holes joined": "2 Array.join",
      "objects joined": "1 Array.join",
      "functions joined": "1 Array.join",
      "numbers sorted": "1 Array.join",
      "texts sorted": "1 Array.join",
      "objects sorted": "1 Array.join",
      "sorted by a function": "1 Array.join",
      "slice": "1 Array.join",
      "map": "1 Array.join",
      "filter": "1 Array.join",
      "concat": "2 Array.join",
      "flat": "2 Array.join",
      "reverse splice": "2 Array.join",
      "push pop shift unshift": "1 Array.join",
      "spread of a list": "1 Array.join",
      "Array.from": "2 Array.join",
      "list to a number": "5 Array.join",
      "spread of bytes": "1 Array.join",
      "spread of a map": "3 Array.join",
      "spread of a set": "1 Array.join",
      "split by a pattern": "1 Array.join",
      "Promise.all": "1 Array.join",
      "Object.keys entries assign": "3 Array.join",
      "text methods": "1 Array.join",
    },
  },
  "array-tostring": {
    replaces: `
  const original5 = Array.prototype.toString;
  Array.prototype.toString = function (...operands) { seen[seen.length] = "Array.toString"; return original5.apply(this, operands); };
  undo[undo.length] = () => { Array.prototype.toString = original5; };`,
    calls: {
      "nested lists joined": "3 Array.toString",
      "String(list)": "1 Array.toString",
      "list in a template": "1 Array.toString",
      "list + text": "1 Array.toString",
      "list.toString()": "1 Array.toString",
      "objects sorted": "1 Array.toString",
      "concat": "1 Array.toString",
      "flat": "1 Array.toString",
      "list to a number": "5 Array.toString",
      "spread of a map": "1 Array.toString",
      "Object.keys entries assign": "1 Array.toString",
    },
  },
  "names-opened-on-object-prototype": {
    replaces: `
  Object.prototype.format = function () { seen[seen.length] = "format"; return "formatted"; };
  undo[undo.length] = () => { delete Object.prototype.format; };
  Object.prototype.toJSON = function () { seen[seen.length] = "toJSON"; return "json"; };
  undo[undo.length] = () => { delete Object.prototype.toJSON; };`,
    calls: {
      "list stringified": "1 toJSON",
      "record stringified": "1 toJSON",
      "Object.keys entries assign": "1 toJSON",
    },
    answers: {
      "list stringified": '"json"',
      "record stringified": '"json"',
      "Object.keys entries assign": 'a,b|a,1|"json"',
    },
  },
  "promise-then": {
    replaces: `
  const original16 = Promise.prototype.then;
  Promise.prototype.then = function (...operands) { seen[seen.length] = "Promise.then"; return original16.apply(this, operands); };
  undo[undo.length] = () => { Promise.prototype.then = original16; };`,
    calls: {
      "Promise.all": "2 Promise.then",
      "Promise.race then": "2 Promise.then",
    },
  },
  "date-and-error-tostring": {
    replaces: `
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
    calls: {
      "record stringified": "2 Date.toJSON,Date.valueOf",
      "String(date)": "1 Date.toString",
      "date to a number": "3 Date.valueOf",
      "String(error)": "2 Error.toString",
    },
  },
  "regexp-exec": {
    replaces: `
  const original10 = RegExp.prototype.exec;
  RegExp.prototype.exec = function (...operands) { seen[seen.length] = "RegExp.exec"; return original10.apply(this, operands); };
  undo[undo.length] = () => { RegExp.prototype.exec = original10; };`,
    calls: {
      "replace by a pattern": "6 RegExp.exec",
      "match search test": "3 RegExp.exec",
      "split by a pattern": "5 RegExp.exec",
      "matchAll": "3 RegExp.exec",
    },
  },
  "map-set-and-set-add": {
    replaces: `
  const original11 = Map.prototype.set;
  Map.prototype.set = function (...operands) { seen[seen.length] = "Map.set"; return original11.apply(this, operands); };
  undo[undo.length] = () => { Map.prototype.set = original11; };
  const original12 = Set.prototype.add;
  Set.prototype.add = function (...operands) { seen[seen.length] = "Set.add"; return original12.apply(this, operands); };
  undo[undo.length] = () => { Set.prototype.add = original12; };`,
    calls: {
      "a map of pairs": "4 Map.set",
      "spread of a map": "2 Map.set",
      "a set of a list": "5 Set.add",
      "spread of a set": "2 Set.add",
      "map get set has": "1 Map.set",
    },
  },
  "statics-and-globals": {
    replaces: `
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
    calls: {
      "Object.keys entries assign": "1 Object.keys",
    },
  },
};

// A word that changes nothing about a run: with it the run says on stderr how it is built.
const saysItsForm = "TestRunSaysItsForm";

// What a run prints behind the line that names the version: the rows of the module of the project and those of the test file, before, while and after the members are replaced.
function printedBy({ calls, answers: answersWhileReplaced = {} }: Omit<Case, "replaces">) {
  return ["before", "replaced", "restored"].flatMap(when =>
    ["src", "test file"].flatMap(where =>
      Object.entries(answers).map(([row, answer]) =>
        when === "replaced"
          ? `replaced ${where} | ${row} | ${answersWhileReplaced[row] ?? answer} | ${calls[row] ?? "0 "}`
          : `${when} ${where} | ${row} | ${answer} | 0 `,
      ),
    ),
  );
}

for (const [name, { replaces, ...stated }] of Object.entries(cases)) {
  test.concurrent(`built-in functions on what the program makes, where tests replace ${name}`, async () => {
    const project = (print: string) =>
      tempDir("tests-replace-" + name, {
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
          ${replaces}
          const replaced = [...await uses("replaced src"), ...await usesHere("replaced test file")];
          while (undo.length) undo.pop()();
          lines.push(...replaced, ...await uses("restored src"), ...await usesHere("restored test file"));
          ${print}
        }, 60000);`,
        "z.test.js": `import { test } from "bun:test";\ntest("z", () => {});\n`,
      });
    using dir = project(`process.stdout.write(lines.join("\\n") + "\\n");`);
    // A program that reads process.stdout is built with the modules of Bun's own code behind that stream, which a lowest layer holds anyway. For the run as one
    // program that is most of the build, so that run has a copy of the project which prints through console.log.
    using dirForOneProgram = project(`console.log(lines.join("\\n"));`);
    const ran = async (cwd: string, words?: string, ...flags: string[]) => {
      const env = words ? { ...bunEnv, TZ: "UTC", BUN_DEBUG_TEST_AOT_WORDS: words } : { ...bunEnv, TZ: "UTC" };
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], cwd, env);
      // A crash prints only there.
      if (exitCode !== 0) console.error(stderr);
      // run() asks a run over layers for its layers. The other compiled run is one program.
      if (words === saysItsForm) expect(stderr).toMatch(/^AOT test run \| one program/m);
      return {
        printed: stdout.split("\n").slice(1),
        results: [...stderr.matchAll(/^\((pass|fail|skip)\) (.*?)(?: \[.*\])?$/gm)].map(
          match => `${match[1]} ${match[2]}`,
        ),
        exitCode,
      };
    };
    const asPlainBun = { printed: [...printedBy(stated), ""], results: ["pass a", "pass z"], exitCode: 0 };
    expect(await ran(String(dir))).toEqual(asPlainBun);
    expect(await ran(String(dirForOneProgram), saysItsForm, "--aot")).toEqual(asPlainBun);
    expect(await ran(String(dir), "TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(asPlainBun);
  });
}
