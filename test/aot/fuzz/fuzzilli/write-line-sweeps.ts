// Programs of one or two lines, one question each, written out in full and not drawn. A build leaves out what a program does not reach, and finds what it reaches by the roads that it knows.
// A road that it does not know shows only where nothing else in the program reaches the same thing, so each program is built alone and holds nothing but its line.
//
//   bun write-line-sweeps.ts <folder> [texts|species|methods|walks|handed|symbols|free|keys|words|refusals|looped|made]      writes <folder>/<family>/<n>-<words>.mjs; the Bun that runs this file says which names, classes and methods there are
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
// refusals  a function of the host or the library is handed one odd value that it cannot take, and its refusal prints the value
// looped    a function of the host or the library is called in a loop at the top of the file, and the first turn is what loads it
// made      a value that native code has made, of a class that the program never names, has one method called or goes through one protocol of the language
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
    "process.execArgv.slice(0, 0).concat(L)",
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
    write(
      "free",
      `read-${name}`,
      `try {\n  console.log(String(${name}));\n} catch (error) {\n  console.log(String(error.name));\n}`,
    );
    // The name handed to the print as it is has stopped builds that its text did not, and it has the build keep the printer: both forms are asked.
    write(
      "free",
      `printed-${name}`,
      `try {\n  console.log(${name});\n} catch (error) {\n  console.log(String(error.name));\n}`,
    );
    write("free", `called-${name}`, `try {\n  ${name}(1);\n} catch (error) {\n  console.log(String(error.name));\n}`);
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
        `FailSpeculations:${1 + (seed % 7)}:${seed}`,
      ])
        under(
          word,
          `all-of-${name}`,
          `import held from "node:${name}";\nconsole.log(typeof held, Object.keys(held).length > 0);`,
        );
}
// refusals
{
  // A function of the host or the library that is handed what it cannot take says so, and its words print the value: the printer of values is a large piece of the library that nothing in such a program names.
  // Each program calls one function once with one odd value and prints the name of the error alone: the words are made where the error is made.
  const odd: [string, string][] = [
    ["a-list-without-a-constructor", `const odd = [new URL("http://made.up/a")];\nodd.constructor = undefined;`],
    [
      "a-table-whose-constructor-is-false",
      `const odd = new Map([[1, new URL("http://made.up/a")]]);\nodd.constructor = false;`,
    ],
    ["a-list-below-nothing", `const odd = Object.setPrototypeOf([{ a: 1 }], null);`],
  ];
  // Nothing that ends or leaves the process, touches the disk or the network, waits for a person, or runs a text.
  const left =
    /exit|abort|kill|spawn|exec|fork|openInEditor|sleep|alert|prompt|confirm|chdir|umask|set[ug]id|setgroups|^rm|unlink|write|mkd|rename|^cp|copy|link|chmod|chown|utimes|trunc|append|listen|connect|fetch|serve|heap|snapshot|^gc$|shrink|debug|inspector|repl|watch|dlopen|binding|^load|require|^import|eval|^run|compile|Script|^build|install|plugin|upgrade|stdin|question|lookup|resolve[46A-Z]|reverse|Worker|cluster|dump|report|profile|coverage|^open|stream|^Bun$|^process$|mmap|^\$$|^sql|^s3|redis|postgres|Cookie|Terminal|cron|secrets|BroadcastChannel|udpSocket|ShadowRealm|^log$/i;
  // Each look prints a text or a truth value. A value that nobody knows, printed as it is, has the build keep the printer: the name of the error printed so showed nothing where its text killed the executable.
  const looks: [string, string][] = [
    ["its-name", "String(error?.name)"],
    ["as-a-text", "String(error).length > 0"],
    ["its-words", "String(error?.message).length > 0"],
  ];
  let look = looks[0][1];
  const ask = (call: string) =>
    `try {\n  const answer = ${call};\n  if (answer && typeof answer.then === "function") answer.then(() => console.log("settled"), error => console.log(${look}));\n  else console.log("answered");\n} catch (error) {\n  console.log(${look});\n}`;
  const callable = (holder: any) =>
    ownNames(holder).filter(name => {
      if (left.test(name)) return false;
      const found = Object.getOwnPropertyDescriptor(holder, name);
      return typeof found?.value === "function";
    });
  const isClass = (value: Function) =>
    /^class\b/.test(Function.prototype.toString.call(value)) || /^[A-Z]/.test(value.name);
  for (const [seen, looking] of looks)
    for (const [value, made] of odd) {
      look = looking;
      const words = `${value}-${seen}`;
      for (const name of callable(globalThis)) {
        if (classOf(name) && name in instances) continue;
        const value = (globalThis as any)[name];
        write(
          "refusals",
          `global-${name}-${words}`,
          `${made}\n${ask(isClass(value) ? `new ${name}(odd)` : `${name}(odd)`)}`,
        );
      }
      for (const name of callable(Bun))
        write(
          "refusals",
          `Bun-${name}-${words}`,
          `${made}\n${ask(isClass((Bun as any)[name]) ? `new Bun.${name}(odd)` : `Bun.${name}(odd)`)}`,
        );
      for (const name of callable(process))
        write("refusals", `process-${name}-${words}`, `${made}\n${ask(`process.${name}(odd)`)}`);
      for (const module of [
      "assert", "async_hooks", "buffer", "crypto", "diagnostics_channel", "events", "fs", "os", "path", "perf_hooks", "querystring", "string_decoder", "timers", "tty", "url", "util", "v8", "zlib",
    ]) {
      const held = require(`node:${module}`);
      for (const name of callable(held))
        write("refusals", `${module}-${name}-${words}`, `import { ${name} as asked } from "node:${module}";\n${made}\n${ask(isClass(held[name]) ? `new asked(odd)` : `asked(odd)`)}`);
    } // prettier-ignore
      for (const [label, fresh, prototype] of [
        ["Buffer", "Buffer.alloc(1)", Buffer.prototype],
        ["EventEmitter", `new (require("node:events"))()`, require("node:events").prototype],
        ["URLSearchParams", `new URLSearchParams("a=1")`, URLSearchParams.prototype],
        ["Headers", `new Headers()`, Headers.prototype],
        ["TextDecoder", `new TextDecoder()`, TextDecoder.prototype],
        ["TextEncoder", `new TextEncoder()`, TextEncoder.prototype],
        ["Blob", `new Blob(["a"])`, Blob.prototype],
        ["FormData", `new FormData()`, FormData.prototype],
        ["EventTarget", `new EventTarget()`, EventTarget.prototype],
        ["AbortController", `new AbortController()`, AbortController.prototype],
        ["Response", `new Response("a")`, Response.prototype],
        ["URL", `new URL("http://made.up/b")`, URL.prototype],
      ] as const)
        for (const name of callable(prototype))
          write("refusals", `${label}-prototype-${name}-${words}`, `${made}\n${ask(`${fresh}.${name}(odd)`)}`);
      for (const [label, holder] of [
        ["Buffer", Buffer],
        ["ReadableStream", ReadableStream],
        ["AbortSignal", AbortSignal],
        ["Response", Response],
        ["URL", URL],
        ["Blob", Blob],
      ] as const)
        for (const name of callable(holder))
          write("refusals", `${label}-${name}-${words}`, `${made}\n${ask(`${label}.${name}(odd)`)}`);
    }
  // looped: the same functions, each called in a loop at the top of the file with three plain values. Nothing in front of the loop has touched the function or its module: the first turn is what loads them.
  // What is printed is the kind of the answer alone, or the name of the error.
  // No try round the call: with one in the turn `util.inspect` answered where the bare loop killed the executable. A function that cannot take a value ends both ways of running alike, so each value has a program of its own.
  const plain: [string, string][] = [
    ["a-record", "{}"],
    ["a-text", '"a"'],
    ["a-number", "1"],
  ];
  let given = plain[0];
  const turns = (call: string) =>
    `for (const value of [${given[1]}, ${given[1]}, ${given[1]}]) console.log(typeof ${call});`;
  for (given of plain) {
    for (const name of callable(globalThis)) {
      if (classOf(name) && name in instances) continue;
      write("looped", `global-${name}-${given[0]}`, turns(isClass((globalThis as any)[name]) ? `new ${name}(value)` : `${name}(value)`));
    }
    for (const name of callable(Bun))
      write("looped", `Bun-${name}-${given[0]}`, turns(isClass((Bun as any)[name]) ? `new Bun.${name}(value)` : `Bun.${name}(value)`));
    for (const module of [
      "assert", "async_hooks", "buffer", "crypto", "diagnostics_channel", "events", "fs", "os", "path", "perf_hooks", "querystring", "string_decoder", "timers", "tty", "url", "util", "v8", "zlib",
    ]) {
      const held = require(`node:${module}`);
      for (const name of callable(held)) {
        write("looped", `${module}-${name}-by-its-name-${given[0]}`, `import { ${name} as asked } from "node:${module}";\n${turns(isClass(held[name]) ? `new asked(value)` : `asked(value)`)}`);
        write("looped", `${module}-${name}-off-the-whole-${given[0]}`, `import held from "node:${module}";\n${turns(isClass(held[name]) ? `new held.${name}(value)` : `held.${name}(value)`)}`);
      }
    }
  } // prettier-ignore
}
// made
{
  // A value of a class of the library or the host comes out of native code: the answer of a call, what a handler is handed, what a promise settles with. The program never names the class. Then it calls one method
  // on the value, or puts it through one protocol of the language that ends in a method of the class. Each program holds one source and one use, AND THE USE STANDS WHERE THE VALUE ARRIVES: a chunk that was first
  // handed on through a promise showed nothing where the same chunk used in its handler killed the executable.
  type Source = [label: string, head: string, made: string, within?: (use: string) => string];
  const sources: Source[] = [
    ["random-bytes", `import crypto from "node:crypto";`, `crypto.randomBytes(2)`],
    ["random-bytes-in-a-callback", `import crypto from "node:crypto";`, `crypto.randomBytes(2)`, use => `crypto.randomBytes(2, (error, value) => {\n${use}\n});`],
    ["a-digest", `import crypto from "node:crypto";`, `crypto.createHash("md5").update("a").digest()`],
    ["a-hash", `import crypto from "node:crypto";`, `crypto.createHash("md5")`],
    ["a-secret-key", `import crypto from "node:crypto";`, `crypto.createSecretKey("ab", "utf8")`],
    ["zipped", `import zlib from "node:zlib";`, `zlib.gzipSync("a")`],
    ["zipped-in-a-callback", `import zlib from "node:zlib";`, `zlib.gzipSync("a")`, use => `zlib.gzip("a", (error, value) => {\n${use}\n});`],
    ["a-file-read", `import fs from "node:fs";`, `fs.readFileSync("/dev/null")`],
    ["a-file-read-in-a-callback", `import fs from "node:fs";`, `fs.readFileSync("/dev/null")`, use => `fs.readFile("/dev/null", (error, value) => {\n${use}\n});`],
    ["a-file-read-by-a-promise", `import fs from "node:fs";`, `fs.readFileSync("/dev/null")`, use => `fs.promises.readFile("/dev/null").then(value => {\n${use}\n});`],
    ["stats", `import fs from "node:fs";`, `fs.statSync("/")`],
    ["stats-in-a-callback", `import fs from "node:fs";`, `fs.statSync("/")`, use => `fs.stat("/", (error, value) => {\n${use}\n});`],
    ["an-entry-of-a-folder", `import fs from "node:fs";`, `fs.readdirSync("/", { withFileTypes: true })[0]`],
    ["a-chunk-of-a-file", `import fs from "node:fs";`, `fs.readFileSync("/dev/null")`, use => `fs.createReadStream(process.execPath, { end: 1 }).once("data", value => {\n${use}\n});`],
    ["an-error-of-the-system", `import fs from "node:fs";`, `(() => { try { fs.readFileSync("/made/up"); } catch (error) { return error; } })()`, use => `try {\n  fs.readFileSync("/made/up");\n} catch (value) {\n${use}\n}`],
    ["an-error-of-assert", `import assert from "node:assert";`, `(() => { try { assert.equal(1, 2); } catch (error) { return error; } })()`, use => `try {\n  assert.equal(1, 2);\n} catch (value) {\n${use}\n}`],
    ["a-datagram", ``, `Buffer.from("hi")`, use => `Bun.udpSocket({ hostname: "127.0.0.1", socket: { data(socket, value) {\n socket.close();\n${use}\n} } }).then(socket => { socket.send("hi", socket.port, "127.0.0.1"); });`],
    ["a-chunk-of-a-socket", ``, `Buffer.from("hi")`, use => `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data(socket, value) {\n socket.end();\n server.stop();\n${use}\n} } });\nBun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open(socket) { socket.write("hi"); }, data() {} } });`],
    ["a-chunk-of-a-net-socket", `import net from "node:net";`, `Buffer.from("hi")`, use => `const server = net.createServer(socket => socket.once("data", value => {\n socket.destroy();\n server.close();\n${use}\n})).listen(0, "127.0.0.1", () => net.connect(server.address().port, "127.0.0.1").end("hi"));`],
    ["headers-of-a-response", ``, `new Response("a").headers`],
    ["the-body-of-a-response", ``, `new Response("a").body`],
    ["the-blob-of-a-response", ``, `await new Response("a").blob()`, use => `new Response("a").blob().then(value => {\n${use}\n});`],
    ["the-bytes-of-a-response", ``, `await new Response("a").bytes()`, use => `new Response("a").bytes().then(value => {\n${use}\n});`],
    ["the-form-of-a-response", ``, `await new Response("a=1", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData()`, use => `new Response("a=1", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData().then(value => {\n${use}\n});`],
    ["the-search-of-a-url", ``, `new URL("http://made.up/a?b=1").searchParams`],
    ["a-url-of-a-path", `import url from "node:url";`, `url.pathToFileURL("/a")`],
    ["a-url-in-the-old-way", `import url from "node:url";`, `url.parse("http://made.up/a?b=1")`],
    ["a-signal", ``, `new AbortController().signal`],
    ["a-mark", ``, `performance.mark("a")`],
    ["a-timer", ``, `setTimeout(() => {}, 0)`],
    ["a-timer-as-this", ``, `setTimeout(() => {}, 0)`, use => `setTimeout(function () {\n const value = this;\n${use}\n}, 0);`],
    ["an-immediate", ``, `setImmediate(() => {})`],
    ["a-file-of-bun", ``, `Bun.file("/dev/null")`],
    ["a-stream-from-a-list", `import stream from "node:stream";`, `stream.Readable.from(["a"])`],
    ["a-decoder", `import decoder from "node:string_decoder";`, `new decoder.StringDecoder()`],
    ["what-was-parsed-of-a-query", `import querystring from "node:querystring";`, `querystring.parse("a=1")`],
    ["an-event", ``, `new Event("x")`, use => `const target = new EventTarget();\ntarget.addEventListener("x", value => {\n${use}\n});\ntarget.dispatchEvent(new Event("x"));`],
    ["the-controller-of-a-stream", ``, `await new Promise(resolve => new ReadableStream({ start: resolve }))`, use => `new ReadableStream({ start(value) {\n${use}\n} });`],
    ["a-text-encoded", ``, `new TextEncoder().encode("a")`],
    ["a-request-in-a-handler", ``, `new Request("http://made.up/")`, use => `const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(value) {\n${use}\n return new Response("ok");\n} });\nfetch(server.url).then(() => server.stop(true));`],
    ["the-server-in-a-handler", ``, `(() => { const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") }); server.stop(true); return server; })()`, use => `const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request, value) {\n${use}\n return new Response("ok");\n} });\nfetch(server.url).then(() => server.stop(true));`],
    ["a-response-that-was-fetched", ``, `new Response("ok")`, use => `const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });\nfetch(server.url).then(value => {\n server.stop(true);\n${use}\n});`],
    ["a-request-of-node", `import http from "node:http";`, `new http.IncomingMessage(null)`, use => `const server = http.createServer((value, response) => {\n response.end("ok");\n server.close();\n${use}\n}).listen(0, "127.0.0.1", () => fetch("http://127.0.0.1:" + server.address().port));`],
    ["a-response-of-node", `import http from "node:http";`, `new http.ServerResponse(new http.IncomingMessage(null))`, use => `const server = http.createServer((request, value) => {\n${use}\n value.end("ok");\n server.close();\n}).listen(0, "127.0.0.1", () => fetch("http://127.0.0.1:" + server.address().port));`],
  ]; // prettier-ignore
  const left =
    /^(?:constructor|write\w*|end|destroy\w*|listen|connect|pipe\w*|cork|uncork|push|unshift|resume|pause|read|wrap|compose|delete|unlink|writer|stream|exists|stat|cancel|tee|getReader|pipeThrough|pipeTo|throwIfAborted|asIndexedPairs|drop|take|flatMap|map|filter|forEach|toArray|some|find|every|reduce|iterator|on|once|off|addListener|prependListener|prependOnceListener|removeListener|removeAllListeners|emit|setTimeout|close\w*|ref|unref|error|enqueue|stop|reload|upgrade|publish|subscribe\w*|unsubscribe|timeout|flushHeaders|assignSocket|detachSocket|setEncoding|json|text|arrayBuffer|bytes|blob|formData|clone|__\w+|_\w+)$/;
  const protocols: [string, string][] = [
    ["as-json", `typeof JSON.stringify(value)`],
    ["as-a-text", `typeof String(value)`],
    ["in-a-template", "typeof `${value}`"],
    ["joined-to-a-text", `typeof (value + "")`],
    ["its-keys", `typeof Object.keys(value).length`],
    ["spread-into-a-record", `typeof { ...value }`],
    ["walked", `typeof value[Symbol.iterator] === "function" ? typeof [...value].length : "cannot be walked"`],
    ["its-tag", `Object.prototype.toString.call(value)`],
    ["as-a-number", `typeof +value`],
    ["compared", `value == "a"`],
    // What goes to the other stream is not held against anything: only that the printer is there and does not die.
    ["printed", `(console.error(value), "printed")`],
  ];
  const ask = ([, head, made, within]: Source, use: string) => {
    // No catch, and what is printed is a text that the compiler knows to be one: see the looks of the refusals. A use that throws ends both ways of running it alike.
    const lines = `console.log(${use});`;
    return `${head ? head + "\n" : ""}${within ? within(lines) : `const value = ${made};\n${lines}`}`;
  };
  for (const source of sources) {
    const [label, head, made] = source;
    for (const [words, use] of protocols) write("made", `${label}-${words}`, ask(source, use));
    let value: any;
    try {
      const names = [...head.matchAll(/^import (\w+) from "(node:\w+)";$/gm)];
      value = await new (Object.getPrototypeOf(async function () {}).constructor)(...names.map(found => found[1]), `return ${made};`)(...names.map(found => require(found[2]))); // prettier-ignore
    } catch {
      continue;
    }
    const seen = new Set<string>();
    for (let at = value; at && at !== Object.prototype && at !== Function.prototype; at = Object.getPrototypeOf(at))
      for (const name of ownNames(at)) {
        if (seen.has(name) || left.test(name)) continue;
        seen.add(name);
        const found = Object.getOwnPropertyDescriptor(at, name);
        if (typeof found?.value === "function")
          write("made", `${label}-calls-${name}`, ask(source, `typeof value.${name}()`));
        else if (found?.get) write("made", `${label}-reads-${name}`, ask(source, `typeof value.${name}`));
      }
  }
}
console.log(`${count} programs`);
