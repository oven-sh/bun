// Small programs about one object with three members, one change to their order, their attributes or what stands above them, and one listing. Names that are indexes come first, in rising order, then
// the other names in the order in which they came, then symbols; a listing takes the enumerable members, and asks accessors. There is one scene, and every line is printed at once, by `console.log`.
//
//   the object   a literal, one out of a function, an instance of a class with fields, with stores, below another class, of a function; what `Object.create`, `Object.assign`, a spread,
//                `Object.fromEntries` and `JSON.parse` make; alone, or beside a twin that is not changed and is listed by the same code
//   the change   `delete`, `delete` and a store, names that are indexes or look like them, a member that is no longer enumerable or writable, an accessor in place of a member, an accessor that
//                removes or adds a member while it is asked, a symbol, `toJSON`, many more members, members above, a hidden member over one above, another prototype, `null` above,
//                `__proto__` as a member, `freeze`, values that JSON leaves out, turns into `null`, unwraps or refuses, the object in itself, `Object.assign` over old and new names
//   the road     where the object is made, in a function that is handed it, under another name, as `this`, in a callback of a built-in, at the end of the constructor
//   the listing  `Object.keys`, `values`, `entries`, `for in`, `JSON.stringify` alone, in a list, in an object, with a list of names, a function or an indentation, a spread, `Object.assign`, the
//                rest of a pattern, `Reflect.ownKeys`, `Object.getOwnPropertyNames`, `Object.getOwnPropertyDescriptors`, `structuredClone`, `Bun.inspect`, `console.log`, `Bun.deepEquals`
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const kind = random.weighted([
    [5, "literal"],
    [3, "factory"],
    [4, "fields"],
    [4, "stores"],
    [3, "below"],
    [2, "function"],
    [1, "created"],
    [1, "assigned"],
    [1, "spread"],
    [1, "from entries"],
    [2, "parsed"],
  ] as const);
  const isAClass = kind === "fields" || kind === "stores" || kind === "below" || kind === "function";

  const changes = (o: string): [number, string][] => [
    [4, `delete ${o}.a;\n${o}.a = 1;`],
    [3, `delete ${o}.a;`],
    [2, `delete ${o}.b;`],
    [2, `delete ${o}.c;\n${o}.c = 2.5;`],
    [2, `delete ${o}.b;\n${o}.d = 4;\n${o}.b = "t";`],
    [3, `${o}[1] = "i";\n${o}[0] = "j";`],
    [2, `${o}["2"] = "i";`],
    [2, `${o}["-1"] = "i";\n${o}["01"] = "j";\n${o}[3] = "k";`],
    [1, `${o}[4294967294] = "i";\n${o}[4294967295] = "j";\n${o}[1] = "k";`],
    [1, `${o}[1.5] = "i";\n${o}[1] = "j";`],
    [4, `Object.defineProperty(${o}, "a", { enumerable: false });`],
    [2, `Object.defineProperty(${o}, "b", { enumerable: false });`],
    [2, `Object.defineProperty(${o}, "b", { writable: false });`],
    [2, `Object.defineProperty(${o}, "d", { value: 4 });`],
    [2, `Object.defineProperty(${o}, "d", { value: 4, enumerable: true });`],
    [4, `Object.defineProperty(${o}, "a", {\nget() {\nreturn "got";\n},\nenumerable: true,\n});`],
    [2, `Object.defineProperty(${o}, "b", {\nget() {\nreturn "got";\n},\n});`],
    [
      3,
      `Object.defineProperty(${o}, "a", {\nget() {\ndelete this.b;\nreturn "got";\n},\nenumerable: true,\nconfigurable: true,\n});`,
    ],
    [
      2,
      `Object.defineProperty(${o}, "a", {\nget() {\nthis.z = 26;\nreturn "got";\n},\nenumerable: true,\nconfigurable: true,\n});`,
    ],
    [
      2,
      `Object.defineProperty(${o}, "a", {\nget() {\nObject.defineProperty(this, "c", { enumerable: false });\nreturn "got";\n},\nenumerable: true,\nconfigurable: true,\n});`,
    ],
    [
      1,
      `Object.defineProperty(${o}, "a", {\nget() {\nthis.b = "later";\nreturn "got";\n},\nenumerable: true,\nconfigurable: true,\n});`,
    ],
    [1, `Object.defineProperty(${o}, "b", {\nset(given) {},\nenumerable: true,\n});`],
    [2, `${o}[Symbol("s")] = "of a symbol";`],
    [2, `${o}.toJSON = function () {\nreturn "as json";\n};`],
    [1, `${o}.toJSON = function () {\nreturn { c: this.c, a: this.a };\n};`],
    [1, `Object.defineProperty(${o}, "toJSON", {\nvalue() {\nreturn [this.a];\n},\n});`],
    [2, `for (let i = 0; i < 20; i++) ${o}["k" + i] = i;`],
    [1, `for (let i = 0; i < 70; i++) ${o}["k" + i] = i;\nfor (let i = 0; i < 70; i++) delete ${o}["k" + i];`],
    [3, `Object.setPrototypeOf(${o}, { above: "above" });`],
    [
      2,
      `Object.setPrototypeOf(${o}, { a: "above", above: "above" });\nObject.defineProperty(${o}, "a", { enumerable: false });`,
    ],
    [2, `Object.setPrototypeOf(${o}, null);`],
    [1, `Object.setPrototypeOf(${o}, {\ntoJSON() {\nreturn "json above";\n},\n});`],
    [1, `Object.setPrototypeOf(${o}, new Proxy({}, {}));`],
    [1, `Object.setPrototypeOf(${o}, [7]);`],
    [2, `Object.getPrototypeOf(${o}) === Object.prototype || (Object.getPrototypeOf(${o}).above = "above");`],
    [2, `Object.defineProperty(${o}, "__proto__", { value: "own", enumerable: true });`],
    [1, `${o}["__proto__"] = { above: "above" };`],
    [2, `Object.freeze(${o});`],
    [1, `Object.seal(${o});`],
    [1, `Object.preventExtensions(${o});`],
    [2, `${o}.a = undefined;`],
    [2, `${o}.b = function () {};`],
    [1, `${o}.b = Symbol("v");`],
    [2, `${o}.a = NaN;\n${o}.c = -0;`],
    [1, `${o}.a = 1n;`],
    [1, `${o}.a = new Date(0);`],
    [1, `${o}.a = new Number(5);\n${o}.b = new String("boxed");\n${o}.c = new Boolean(false);`],
    [2, `${o}.a = ${o};`],
    [1, `${o}.a = [${o}.c, , undefined];`],
    [1, `${o}.a = {\ntoJSON(key) {\nreturn "under " + key;\n},\n};`],
    [1, `${o}.a = "\\u2028\\ud800\\"";`],
    [2, `${o}.a = "text";\n${o}.b = 7;\n${o}.c = null;`],
    [2, `Object.assign(${o}, { d: 4, a: 9 });`],
    [1, `Object.assign(${o}, { 0: "i", c: 9, [Symbol.iterator]: null });`],
    [1, `({ a: ${o}.c, c: ${o}.a } = ${o});`],
    [1, `${o}.d = 4;\ndelete ${o}.d;`],
    [1, `Object.defineProperties(${o}, { c: { enumerable: false }, d: { value: 4, enumerable: true } });`],
  ];

  const road = random.weighted([
    [5, "direct"],
    [3, "handed"],
    [2, "another name"],
    [2, "this"],
    [1, "callback"],
    [isAClass ? 4 : 0, "constructor"],
  ] as const);
  const change = random.weighted(
    changes(
      road === "handed"
        ? "given"
        : road === "another name"
          ? "again"
          : road === "this" || road === "constructor"
            ? "this"
            : "o",
    ),
  );
  const atTheEnd = road === "constructor" ? `if (changes) {\n${change}\n}\n` : "";
  const p = road === "constructor" ? "changes" : "";

  const declared = {
    literal: "",
    factory: 'function make() {\nreturn { a: 1, b: "t", c: 2.5 };\n}',
    fields: `class K {\na = 1;\nb = "t";\nc = 2.5;\n${atTheEnd ? `constructor(${p}) {\n${atTheEnd}}\n` : ""}}`,
    stores: `class K {\nconstructor(${p}) {\nthis.a = 1;\nthis.b = "t";\nthis.c = 2.5;\n${atTheEnd}}\n}`,
    below: `class Above {\na = 1;\n}\nclass K extends Above {\nb = "t";\nc = 2.5;\n${atTheEnd ? `constructor(${p}) {\nsuper();\n${atTheEnd}}\n` : ""}}`,
    function: `function K(${p}) {\nthis.a = 1;\nthis.b = "t";\nthis.c = 2.5;\n${atTheEnd}}`,
    created: "",
    assigned: "",
    spread: "",
    "from entries": "",
    parsed: "",
  }[kind];
  const make = (isChanged: boolean) =>
    ({
      literal: '{ a: 1, b: "t", c: 2.5 }',
      factory: "make()",
      fields: `new K(${road === "constructor" ? isChanged : ""})`,
      stores: `new K(${road === "constructor" ? isChanged : ""})`,
      below: `new K(${road === "constructor" ? isChanged : ""})`,
      function: `new K(${road === "constructor" ? isChanged : ""})`,
      created: 'Object.assign(Object.create({}), { a: 1, b: "t", c: 2.5 })',
      assigned: 'Object.assign({ a: 1 }, { b: "t", c: 2.5 })',
      spread: '{ a: 1, ...{ b: "t", c: 2.5 } }',
      "from entries": 'Object.fromEntries([\n["a", 1],\n["b", "t"],\n["c", 2.5],\n])',
      parsed: `JSON.parse('{"a":1,"b":"t","c":2.5}')`,
    })[kind];

  const listings = (o: string): [number, string][] => [
    [5, `console.log(Object.keys(${o}).join());`],
    [6, `console.log(JSON.stringify(${o}));`],
    [
      2,
      `console.log(Object.values(${o}).map(value => typeof value === "function" ? "function" : String(value)).join());`,
    ],
    [3, `console.log(JSON.stringify(Object.entries(${o})));`],
    [4, `{\nlet all = "";\nfor (const key in ${o}) all += key + " ";\nconsole.log(all);\n}`],
    [
      1,
      `{\nlet all = "";\nfor (const key in ${o}) all += key + ":" + (typeof ${o}[key] === "function" ? "function" : String(${o}[key])) + " ";\nconsole.log(all);\n}`,
    ],
    [3, `console.log(JSON.stringify({ ...${o} }));`],
    [2, `console.log(Object.keys({ ...${o} }).join());`],
    [2, `console.log(JSON.stringify(Object.assign({}, ${o})));`],
    [3, `{\nconst { a, ...others } = ${o};\nconsole.log(String(a), JSON.stringify(others));\n}`],
    [1, `{\nconst { b, ...others } = ${o};\nconsole.log(Object.keys(others).join());\n}`],
    [3, `console.log(Reflect.ownKeys(${o}).map(String).join());`],
    [2, `console.log(Object.getOwnPropertyNames(${o}).join());`],
    [1, `console.log(JSON.stringify(structuredClone(${o})));`],
    [2, `console.log(JSON.stringify(Object.getOwnPropertyDescriptors(${o})));`],
    [2, `console.log(Bun.inspect(${o}));`],
    [2, `console.log(${o});`],
    [1, `console.log(JSON.stringify([${o}, ${o}]));`],
    [2, `console.log(JSON.stringify({ inner: ${o} }));`],
    [1, `console.log(JSON.stringify(${o}, null, 1));`],
    [2, `console.log(JSON.stringify(${o}, ["c", "a", "d", "0"]));`],
    [1, `console.log(JSON.stringify(${o}, (key, value) => (key === "b" ? undefined : value)));`],
    [1, `console.log(Object.keys(${o}).length, Object.values(${o}).length, Object.entries(${o}).length);`],
    [
      2,
      `console.log(\nObject.entries(${o})\n.map(([key, value]) => key + "=" + (typeof value === "function" ? "function" : String(value)))\n.join(),\n);`,
    ],
    [
      2,
      `{\nlet all = "";\nfor (const key of Object.keys(${o})) all += key + ":" + (typeof ${o}[key] === "function" ? "function" : String(${o}[key])) + " ";\nconsole.log(all);\n}`,
    ],
    [
      1,
      `{\nlet all = "";\nfor (const [key, value] of Object.entries(${o})) all += key + ":" + (typeof value === "function" ? "function" : String(value)) + " ";\nconsole.log(all);\n}`,
    ],
    [
      1,
      `console.log(Bun.deepEquals(${o}, { a: 1, b: "t", c: 2.5 }), Bun.deepEquals(${o}, { a: 1, b: "t", c: 2.5 }, true));`,
    ],
    [1, `console.log(Object.hasOwn(${o}, "a"), "a" in ${o}, Object.prototype.propertyIsEnumerable.call(${o}, "a"));`],
    [1, `console.log(Object.keys(${o})[0], Object.keys(${o}).at(-1));`],
    [1, `console.log(JSON.stringify(Object.fromEntries(Object.entries(${o}))));`],
  ];

  const applied = {
    direct: change,
    handed: "alter(o);",
    "another name": `const again = [o][0];\n${change}`,
    this: `(function () {\n${change}\n}).call(o);`,
    callback: `[0].forEach(() => {\n${change}\n});`,
    constructor: "",
  }[road];
  const alter = road === "handed" ? `function alter(given) {\n${change}\n}` : "";

  const twin = random.chance(0.4);
  const how = twin
    ? random.pick(["loop", "loop", "function", "both written"] as const)
    : random.pick(["written", "written", "written", "function"] as const);
  const listing = random.weighted(listings(how === "loop" ? "each" : how === "function" ? "shown" : "o"));
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error?.constructor.name);\n}`;
  const show = how === "function" ? `function show(shown) {\n${listing}\n}` : "";
  const order = random.chance(0.5);
  const lists =
    how === "loop"
      ? `for (const each of ${order ? "[twin, o]" : "[o, twin]"}) {\n${listing}\n}`
      : how === "function"
        ? twin
          ? order
            ? "show(twin);\nshow(o);"
            : "show(o);\nshow(twin);"
          : "show(o);"
        : how === "both written"
          ? `${listing}\n${listing.replaceAll(/\bo\b/g, "twin")}`
          : listing;
  const early = random.chance(0.2) && how !== "both written" ? lists + "\n" : "";
  const scene = [
    `const o = ${make(true)};`,
    twin ? `const twin = ${make(false)};` : "",
    road === "constructor" ? "" : early,
    applied,
    lists,
    random.chance(0.15) ? lists : "",
  ]
    .filter(Boolean)
    .join("\n");
  const head = [declared, alter, show].filter(Boolean).join("\n");
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const place = random.pick(["top", "top", "once", "once", "thrice"] as const);
  if (place === "top") return { file, text: `${head ? head + "\n" : ""}${guarded(scene)}\n` };
  return {
    file,
    text: `${head ? head + "\n" : ""}function run() {\n${scene}\n}\n${guarded(place === "once" ? "run();" : "run();\nrun();\nrun();")}\n`,
  };
}
