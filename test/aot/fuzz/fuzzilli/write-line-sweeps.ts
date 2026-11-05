// Programs of one or two lines, one question each, written out in full and not drawn. A build leaves out what a program does not reach, and finds what it reaches by the roads that it knows.
// A road that it does not know shows only where nothing else in the program reaches the same thing, so each program is built alone and holds nothing but its line.
//
//   bun write-line-sweeps.ts <folder> [texts|species|methods|walks|handed|symbols|free|keys|words]      writes <folder>/<family>/<n>-<words>.mjs; the Bun that runs this file says which names, classes and methods there are
//
// texts     the name of a member or a global spelled as a value: a literal, a piece of a template, a join, a sum, a comparison, the key of a Map
// species   a static method called off a class that came by `[Symbol.species]`, by a pattern, by `.constructor` of an instance or of the prototype
// methods   a method of a built-in prototype called once: by its name, by a computed name, off the prototype, through Reflect.apply(), taken out by a pattern
// walks     something that can be walked goes into something that walks it
// handed    `process`, `console` or `Bun` comes to code of the program by a road on which nobody names it, and that code reads one member
// symbols   a well-known symbol is held in a variable, a field, a pattern or a function, and a member is read, called, asked for or laid under it
// free      a name that nothing declares and that is spelled like a member of a built-in is asked for by `typeof`, read, called
// keys      a member is read under a key that lies in a variable at the top of the file
// words     a module of the library is loaded, under a word of `--aot-testing` that may only change cost and under many seeds
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [out, only] = process.argv.slice(2);
let count = 0;
function write(family: string, words: string, text: string) {
  if (only && only !== family) return;
  mkdirSync(join(out, family), { recursive: true });
  const name = `${String(++count).padStart(5, "0")}-${words.replace(/[^\w$]+/g, "-").slice(0, 100)}.mjs`;
  writeFileSync(join(out, family, name), text + "\n");
}
const isName = (key: string) => /^[A-Za-z_$][\w$]*$/.test(key);
const ownNames = (holder: object) => Object.getOwnPropertyNames(holder).filter(isName);
const halves = (word: string) =>
  [word.slice(0, word.length >> 1), word.slice(word.length >> 1)].map(half => JSON.stringify(half));

/** An instance of each class of the language, and of Buffer. */
const instances: Record<string, string> = {
  Array: "[1, 2]",
  String: '"ab"',
  Number: "1.5",
  Boolean: "true",
  BigInt: "1n",
  Symbol: 'Symbol("a")',
  Function: "(function () {})",
  Object: "({ a: 1 })",
  Map: "new Map([[1, 2]])",
  Set: "new Set([1])",
  WeakMap: "new WeakMap()",
  WeakSet: "new WeakSet()",
  Promise: "Promise.resolve(1)",
  RegExp: "/a/g",
  Date: "new Date(0)",
  Error: 'new Error("a")',
  ArrayBuffer: "new ArrayBuffer(8)",
  SharedArrayBuffer: "new SharedArrayBuffer(8)",
  DataView: "new DataView(new ArrayBuffer(8))",
  Int8Array: "new Int8Array(2)",
  Uint8Array: "new Uint8Array(2)",
  Uint8ClampedArray: "new Uint8ClampedArray(2)",
  Int16Array: "new Int16Array(2)",
  Uint16Array: "new Uint16Array(2)",
  Int32Array: "new Int32Array(2)",
  Uint32Array: "new Uint32Array(2)",
  Float32Array: "new Float32Array(2)",
  Float64Array: "new Float64Array(2)",
  BigInt64Array: "new BigInt64Array(2)",
  BigUint64Array: "new BigUint64Array(2)",
  Buffer: "Buffer.alloc(2)",
  Iterator: "[1, 2].values()",
  URL: 'new URL("http://a.test/")',
  URLSearchParams: 'new URLSearchParams("a=1")',
  TextEncoder: "new TextEncoder()",
  TextDecoder: "new TextDecoder()",
  AbortController: "new AbortController()",
  Headers: "new Headers()",
};
const classOf = (name: string) => (globalThis as any)[name] as (Function & Record<PropertyKey, unknown>) | undefined;

// texts
{
  const names = new Set<string>(ownNames(globalThis));
  for (const holder of [Object, Function, Array, Promise, Symbol, Reflect, String, Number, JSON, Math, process, Bun])
    for (const name of ownNames(holder)) names.add(name);
  for (const holder of [Object, Function, Array, Promise, String, RegExp, Error, Map, Set, Symbol])
    for (const name of ownNames(holder.prototype)) names.add(name);
  for (const name of [
    "done",
    "value",
    "default",
    "exports",
    "module",
    "require",
    "raw",
    "get",
    "set",
    "enumerable",
    "cause",
    "__proto__",
  ])
    names.add(name);
  for (const name of [...names].sort()) {
    const text = JSON.stringify(name);
    const [first, second] = halves(name);
    write("texts", `literal-${name}`, `console.log(${text});`);
    write("texts", `template-${name}`, `console.log(\`${name}\${Date.now() > 0 ? "" : "x"}\`);`);
    write("texts", `join-${name}`, `console.log([${first}, ${second}].join(""));`);
    write("texts", `sum-${name}`, `console.log(${first} + ${second});`);
    write("texts", `compared-${name}`, `const word = Date.now() > 0 ? ${text} : "a";\nconsole.log(word === ${text});`);
    write("texts", `key-of-a-map-${name}`, `console.log(new Map([[${text}, 1]]).get(${text}));`);
  }
  write(
    "texts",
    "defined-on-the-global-object",
    `Object.defineProperty(globalThis, "madeUp", { value: 1 });\nconsole.log(madeUp);`,
  );
  write(
    "texts",
    "several-defined-on-the-global-object",
    `Object.defineProperties(globalThis, { madeUp: { value: 1 } });\nconsole.log(madeUp);`,
  );
}

// species
for (const [name, instance] of Object.entries(instances)) {
  const made = classOf(name);
  if (!made) continue;
  const statics = new Set<string>();
  for (
    let holder: object | null = made;
    holder && holder !== Function.prototype;
    holder = Object.getPrototypeOf(holder)
  )
    for (const key of ownNames(holder)) if (typeof (made as any)[key] === "function") statics.add(key);
  const roads: [string, string][] = [
    ["constructor-of-an-instance", `const Maker = ${instance}.constructor;`],
    ["constructor-of-the-prototype", `const Maker = ${name}.prototype.constructor;`],
    ["constructor-above-an-instance", `const Maker = Object.getPrototypeOf(${instance}).constructor;`],
  ];
  if (Symbol.species in made)
    roads.push(
      ["species", `const Maker = ${name}[Symbol.species];`],
      ["species-by-a-pattern", `const { [Symbol.species]: Maker } = ${name};`],
      ["species-by-reflect", `const Maker = Reflect.get(${name}, Symbol.species);`],
    );
  for (const [road, line] of roads)
    for (const key of statics)
      write("species", `${road}-${name}-${key}`, `${line}\nconsole.log(typeof Maker.${key}());`);
}

// methods
for (const [name, instance] of Object.entries(instances)) {
  const made = classOf(name);
  if (!made?.prototype) continue;
  for (const key of ownNames(made.prototype as object)) {
    const described = Object.getOwnPropertyDescriptor(made.prototype, key)!;
    if (typeof described.value !== "function" || key === "constructor") continue;
    const [first, second] = halves(key);
    const shown = (call: string) => `console.log(typeof ${call});`;
    write("methods", `named-${name}-${key}`, shown(`${instance}.${key}()`));
    write("methods", `by-a-text-${name}-${key}`, shown(`${instance}[${JSON.stringify(key)}]()`));
    write(
      "methods",
      `by-a-joined-text-${name}-${key}`,
      `const name = [${first}, ${second}].join("");\n${shown(`${instance}[name]()`)}`,
    );
    write("methods", `off-the-prototype-${name}-${key}`, shown(`${name}.prototype.${key}.call(${instance})`));
    write("methods", `by-reflect-${name}-${key}`, shown(`Reflect.apply(${name}.prototype.${key}, ${instance}, [])`));
    write(
      "methods",
      `by-a-pattern-${name}-${key}`,
      `const { ${key}: taken } = ${instance};\n${shown(`taken.call(${instance})`)}`,
    );
    write("methods", `read-and-never-called-${name}-${key}`, `console.log(typeof ${instance}.${key});`);
  }
}

// walks
{
  const plain = "4, 5, 4";
  const pairs = '["a", 1], ["b", 2], ["a", 3]';
  const lists = (items: string) => [
    `[${items}]`,
    `JSON.parse(${JSON.stringify(`[${items}]`)})`,
    `Object.freeze([${items}])`,
    `Object.freeze([${items}, , ${items}])`,
    `[${items}].slice()`,
    `[${items}].map(each => each)`,
    `structuredClone([${items}])`,
    `Array.of(${items})`,
    `Array.from([${items}])`,
    `new (class extends Array {})(${items})`,
  ];
  const sources = [
    "L",
    "L.values()",
    "L.keys()",
    "L.entries()",
    "L[Symbol.iterator]()",
    "new Set(L)",
    "new Set(L).values()",
    "(function () { return arguments; })(...L)",
    "((...all) => all)(...L)",
    "(texts => texts)`a${1}b${2}a`",
    "process.execArgv.concat(L)",
    "Object.values(L)",
    "Object.entries(L)",
    "(function* () { yield* L; })()",
    "L.values().map(each => each)",
    "Iterator.from(L)",
    "({ [Symbol.iterator]: () => L.values() })",
    "L.toReversed()",
    "L.flat()",
  ];
  const sinks: [string, boolean][] = [
    ["new Map(S).size", true],
    ["[...new Map(S)].join()", true],
    ["JSON.stringify(Object.fromEntries(S))", true],
    ["new Set(S).size", false],
    ["[...new Set(S)].join()", false],
    ["new Uint8Array(S).join()", false],
    ["Uint8Array.from(S).length", false],
    ["new Float64Array(S).join()", false],
    ["Array.from(S).length", false],
    ["[...S].join()", false],
    ["Math.max(...S)", false],
    ["((...all) => all.length)(...S)", false],
    ['(([first, second]) => first + "|" + second)(S)', false],
    ["Buffer.from(S).length", false],
    ["Array.from(S, each => each).join()", false],
    ["new Set(S).union(new Set([9])).size", false],
  ];
  for (const [sink, takesPairs] of sinks)
    lists(takesPairs ? pairs : plain).forEach((list, at) =>
      sources.forEach((source, from) =>
        write(
          "walks",
          `list-${at}-source-${from}-${sink}`,
          `const rows = ${list};\nconsole.log(${sink.replace(/\bS\b/g, `(${source.replace(/\bL\b/g, "rows")})`)});`,
        ),
      ),
    );
}
// handed
{
  const holders: [string, object][] = [
    ["process", process],
    ["console", console],
    ["Bun", Bun],
  ];
  /** Each road brings the holder to code of the program that does not name it. `H` is the holder, `M` the member. */
  const roads: [string, string][] = [
    [
      "has-instance",
      `class Kind { static [Symbol.hasInstance](value) { console.log(typeof value.M); return true; } }\nconsole.log(H instanceof Kind);`,
    ],
    ["a-callback-of-a-list", `[H].forEach(each => console.log(typeof each.M));`],
    ["a-callback-of-a-map", `new Map([[1, H]]).forEach(each => console.log(typeof each.M));`],
    ["a-promise", `Promise.resolve(H).then(each => console.log(typeof each.M));`],
    ["this-by-call", `console.log(function () { return typeof this.M; }.call(H));`],
    ["this-by-bind", `console.log(function () { return typeof this.M; }.bind(H)());`],
    ["this-by-reflect", `console.log(Reflect.apply(function () { return typeof this.M; }, H, []));`],
    ["arguments", `console.log((function () { return typeof arguments[0].M; })(H));`],
    ["a-rest-list", `console.log(((...all) => typeof all[0].M)(H));`],
    ["a-generator", `function* give() { yield H; }\nfor (const each of give()) console.log(typeof each.M);`],
    [
      "a-replacer",
      `JSON.stringify({ held: 1 }, function (key, value) { if (key === "held") console.log(typeof this.from.M); return value; }.bind({ from: H }));`,
    ],
    ["a-proxy", `console.log(typeof new Proxy(H, {}).M);`],
    ["an-heir", `console.log(typeof Object.create(H).M);`],
    ["a-field", `const box = { held: H };\nconsole.log(typeof box[["he", "ld"].join("")].M);`],
    ["a-getter-of-the-program", `const box = { get held() { return H; } };\nconsole.log(typeof box.held.M);`],
    ["a-default", `console.log(((each = H) => typeof each.M)());`],
    ["a-pattern", `const [{ M: taken }] = [H];\nconsole.log(typeof taken);`],
    [
      "a-conversion",
      `const probe = { [Symbol.toPrimitive]() { console.log(typeof this.from.M); return 1; }, from: H };\nconsole.log(+probe);`,
    ],
    ["the-global-object", `console.log(typeof globalThis[["H".slice(0, 1), "H".slice(1)].join("")].M);`],
    ["a-sort", `[H, H].sort((one, other) => (console.log(typeof one.M), 0));`],
  ];
  for (const [holder, held] of holders)
    for (const member of ownNames(held))
      for (const [road, text] of roads)
        write("handed", `${road}-${holder}-${member}`, text.replace(/\bH\b/g, holder).replace(/\bM\b/g, member));
}
// symbols
{
  /** Who has a member under each well-known symbol, and an object of the program's own that lays one there with what asks for it. `K` is the key as it is held. */
  const known: Record<string, { holders: string[]; own: string[] }> = {
    iterator: {
      holders: ["[1, 2]", '"ab"', "new Map([[1, 2]])", "new Set([1])", "Array.prototype", "String.prototype", "new Uint8Array(2)"],
      own: ["class Row { *[K]() { yield 1; yield 2; } }\nconsole.log([...new Row()].join());", "const row = { [K]() { return [7][Symbol.iterator](); } };\nfor (const each of row) console.log(each);"],
    },
    asyncIterator: {
      holders: ["(async function* () {})()", "ReadableStream.prototype"],
      own: ["const row = { async *[K]() { yield 1; } };\nfor await (const each of row) console.log(each);"],
    },
    hasInstance: { holders: ["Function.prototype", "Array"], own: ["class Odd { static [K](value) { return value === 1; } }\nconsole.log(1 instanceof Odd, 2 instanceof Odd);"] },
    isConcatSpreadable: { holders: ["[1]"], own: ["console.log([0].concat({ [K]: true, length: 2, 0: 1, 1: 2 }).length);"] },
    match: { holders: ["/a/", "RegExp.prototype"], own: ['console.log("abc".match({ [K](text) { return text.length; } }));'] },
    matchAll: { holders: ["/a/g", "RegExp.prototype"], own: ['console.log("abc".matchAll({ [K](text) { return text.length; } }));'] },
    replace: { holders: ["/a/", "RegExp.prototype"], own: ['console.log("abc".replace({ [K](text, by) { return text + by; } }, "!"));'] },
    search: { holders: ["/a/", "RegExp.prototype"], own: ['console.log("abc".search({ [K](text) { return text.length; } }));'] },
    split: { holders: ["/a/", "RegExp.prototype"], own: ['console.log("abc".split({ [K](text) { return [text.length]; } }).join());'] },
    species: { holders: ["Array", "Map", "Promise", "RegExp", "ArrayBuffer"], own: ["class Mine extends Array { static get [K]() { return Array; } }\nconsole.log(new Mine(1, 2, 3).map(each => each) instanceof Mine);"] },
    toPrimitive: { holders: ["Date.prototype", "Symbol.prototype", "new Date(0)"], own: ["console.log({ [K](hint) { return hint.length; } } + 1, `${{ [K]() { return 7; } }}`);"] },
    toStringTag: {
      holders: ["Math", "JSON", "new Map()", "Promise.prototype", "Symbol.prototype"],
      own: ['class Crate { get [K]() { return "crate"; } }\nconsole.log(new Crate()[K], Object.prototype.toString.call(new Crate()));'],
    },
    unscopables: { holders: ["Array.prototype"], own: ["console.log(typeof { [K]: { a: true } }[K].a);"] },
    dispose: { holders: ["new DisposableStack()", "DisposableStack.prototype"], own: ['{\n  using held = { [K]() { console.log("let go"); } };\n  console.log(typeof held);\n}'] },
    asyncDispose: { holders: ["new AsyncDisposableStack()", "AsyncDisposableStack.prototype"], own: ['{\n  await using held = { async [K]() { console.log("let go"); } };\n  console.log(typeof held);\n}'] },
  }; // prettier-ignore
  /** How the symbol is held: the lines in front, and what stands for it. `X` is its name on `Symbol`. */
  const ways: [string, string, string][] = [
    ["a-const", "const key = Symbol.X;", "key"],
    ["a-let", "let key = Symbol.X;", "key"],
    ["a-var", "var key = Symbol.X;", "key"],
    ["a-pattern", "const { X: key } = Symbol;", "key"],
    ["symbol-under-a-name", "const S = Symbol;\nconst key = S.X;", "key"],
    ["a-field", "const keys = { held: Symbol.X };", "keys.held"],
    ["a-function", "function key() { return Symbol.X; }", "key()"],
    ["under-a-text", 'const key = Symbol["X"];', "key"],
    ["out-of-a-list", "const key = [Symbol.X][0];", "key"],
    ["by-reflect", 'const key = Reflect.get(Symbol, "X");', "key"],
    ["a-static", "class Keys { static held = Symbol.X; }", "Keys.held"],
    ["a-const-in-a-function", "", "key"],
  ];
  for (const [name, { holders, own }] of Object.entries(known))
    for (const [way, front, key] of ways) {
      const uses = [
        ...holders.flatMap(holder => [
          `console.log(typeof ${holder}[K]);`,
          `console.log(K in Object(${holder}), Object(${holder})[K] === Object(${holder})[Symbol.${name}]);`,
        ]),
        ...(name === "iterator"
          ? holders
              .filter(holder => !holder.includes("prototype"))
              .map(holder => `console.log(${holder}[K]().next().value);`)
          : []),
        ...own,
      ];
      uses.forEach((use, at) => {
        const text = use.replace(/\bK\b/g, key);
        const isAsync = /\bawait\b/.test(text);
        write(
          "symbols",
          `${name}-${way}-${at}`,
          way === "a-const-in-a-function"
            ? `${isAsync ? "async " : ""}function run() {\n  const key = Symbol.${name};\n${text}\n}\n${isAsync ? "await " : ""}run();`
            : `${front.replace(/\bX\b/g, name)}\n${text}`,
        );
      });
    }
}
// free
{
  // A name that nothing declares, spelled like a member of a built-in: `typeof map`, `at`, `find(1)`. The language answers "undefined" or throws a ReferenceError.
  const names = new Set<string>();
  const reserved = new Set("arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(" ")); // prettier-ignore
  for (const global of ownNames(globalThis)) {
    let held: unknown;
    try {
      held = (globalThis as Record<string, unknown>)[global];
    } catch {
      continue;
    }
    if ((typeof held !== "object" && typeof held !== "function") || held === null) continue;
    for (const holder of [held, (held as { prototype?: unknown }).prototype])
      if ((typeof holder === "object" || typeof holder === "function") && holder !== null)
        for (const name of ownNames(holder)) if (!(name in globalThis) && !reserved.has(name)) names.add(name);
  }
  for (const name of [...names].sort()) {
    write("free", `typeof-${name}`, `console.log(typeof ${name});`);
    write("free", `read-${name}`, `try {\n  console.log(${name});\n} catch (error) {\n  console.log(error.name);\n}`);
    write("free", `called-${name}`, `try {\n  ${name}(1);\n} catch (error) {\n  console.log(error.name);\n}`);
  }
}
// keys
{
  // A member is read under a key that lies in a variable at the top of a module and that a function changes.
  const holders: [string, string, string[]][] = [
    ["a-list-of-texts", 'const held = ["idle", "busy", "done"];', ["0", "1"]],
    ["a-list-of-numbers", "const held = [1, 2, 3];", ["0", "1"]],
    ["a-record", "const held = { idle: 1, busy: 2 };", ['"idle"', '"busy"']],
    ["a-text", 'const held = "abc";', ["0", "1"]],
    ["a-view", "const held = new Uint8Array([1, 2, 3]);", ["0", "1"]],
    ["a-map-of-functions", "const held = { idle() { return 1; }, busy() { return 2; } };", ['"idle"', '"busy"']],
    ["an-instance", "class Kind { idle = 1; busy = 2; }\nconst held = new Kind();", ['"idle"', '"busy"']],
    ["arguments", "const held = (function () { return arguments; })(1, 2, 3);", ["0", "1"]],
  ];
  for (const [name, made, [first, second]] of holders)
    for (const word of ["var", "let", "const"])
      for (const [how, lines] of [
        [
          "stepped",
          first === "0"
            ? `function advance() { if (state < 2) state++; return held[state]; }`
            : `function advance() { state = ${second}; return held[state]; }`,
        ],
        ["stored", `function advance() { state = ${second}; return held[state]; }`],
        ["only-read", `function advance() { return held[state]; }`],
        ["at-the-top", `const advance = () => held[state];`],
      ] as const) {
        if (word === "const" && (how === "stepped" || how === "stored")) continue;
        write(
          "keys",
          `${name}-${word}-${how}`,
          `${made}\n${word} state = ${first};\n${lines}\nconst say = value => String(typeof value === "function" ? value() : value);\nconsole.log(say(advance()), say(advance()));\nexport {};`,
        );
      }
}
// words
{
  // Most of what a small program compiles is the library. A word of `--aot-testing` that may only change cost, under many seeds, asks the compiler about the library what no program of ours would:
  // other types expected, other choices taken, guesses that fail. The first line of each program names the word, and `run-alone.ts --programs` builds it with that word.
  const modules = [
    "assert", "async_hooks", "buffer", "child_process", "cluster", "crypto", "dgram", "dns", "events", "fs", "http", "http2", "https", "net", "os", "path", "perf_hooks",
    "querystring", "readline", "stream", "string_decoder", "timers", "tls", "tty", "url", "util", "v8", "vm", "worker_threads", "zlib",
  ]; // prettier-ignore
  const under = (word: string, name: string, text: string) =>
    write("words", `${name}-${word}`, `// Flags: --aot-testing=${word}\n${text}`);
  for (let seed = 1; seed <= 120; seed++)
    under(
      `ShuffleExpectedTypes:${seed}`,
      "one-member-of-http",
      `import http from "node:http";\nconsole.log(typeof http.createServer);`,
    );
  for (const name of modules)
    for (let seed = 1; seed <= 8; seed++)
      for (const word of [
        `ShuffleExpectedTypes:${seed}`,
        `ShuffleChoices:${seed}`,
        `ShuffleBlockFrequencies:${seed}`,
        `FailGuesses:${1 + (seed % 7)}:${seed}`,
      ])
        under(
          word,
          `all-of-${name}`,
          `import held from "node:${name}";\nconsole.log(typeof held, Object.keys(held).length > 0);`,
        );
}
console.log(`${count} programs`);
