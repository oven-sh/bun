// Small programs in which something is written that no other place of the program names: a field, a parameter, a result, a variable, a method, a class, an export. One road still sees it, or what it
// does when it is made: a listing, a copy, a key that is computed, `arguments`, a protocol of the language. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   a field      of a class, a class above, a literal, a function that stores to `this`, a function that returns a literal, records in a list; it holds a number, what a call answers, an object, a getter
//   seen by      keys, values, entries, own names, own keys, descriptors, `for in`, JSON in six forms, a spread, a rest, `Object.assign`, `structuredClone`, a proxy, `console.log` of the object,
//                `Bun.inspect`, `Bun.deepEquals`, a key that is joined, cut, parsed, drawn from a list or chosen at run time, under `[]`, `in`, `hasOwn`, `Reflect.get`
//   a parameter  seen by `arguments`, `length` of the function, a rest; its default, its pattern and its argument run whether it is read or not
//   a result     that nobody uses, of a getter, a conversion, a trap, a constructor, an iteration, `toJSON`, `then`
//   a variable   that nobody reads: its initializer, the getters its pattern asks, static fields, computed keys and the class above of a class nobody uses
//   a method, a class  reached under a computed key, by a listing, through `constructor`, through a protocol
//   an export    reached by the keys of the namespace, a computed key, `import()`, `require`; a file that is imported for nothing
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files?: Record<string, string> } {
  const head = `let log = "";\nfunction tell(what) {\nlog += what + " ";\nreturn what.length;\n}\n`;
  const hiddenValue = random.pick([
    "7",
    "7",
    '"kept"',
    'tell("made")',
    "{ inner: 1 }",
    "[1, 2]",
    "null",
    "undefined",
    "() => 1",
  ]);
  const computedKey = () =>
    random.pick([
      `["hid", "den"].join("")`,
      `"xhidden".slice(1)`,
      `JSON.parse('"hidden"')`,
      `"hid" + "den"`,
      `process.argv.length > 99 ? "x" : "hidden"`,
      `["x", "hidden"][1]`,
      `String.fromCharCode(104, 105, 100, 100, 101, 110)`,
      '`hid${"den"}`',
      `Object.keys({ hidden: 0 })[0]`,
    ]);

  const field = (): string => {
    const [declared, made] = random.pick<[string, string]>([
      [`class K {\nx = 1;\nhidden = ${hiddenValue};\n}`, "new K()"],
      [`class K {\nhidden = ${hiddenValue};\nx = 1;\n}`, "new K()"],
      [`class Above {\nhidden = ${hiddenValue};\n}\nclass K extends Above {\nx = 1;\n}`, "new K()"],
      [`class K {\nconstructor() {\nthis.x = 1;\nthis.hidden = ${hiddenValue};\n}\n}`, "new K()"],
      [`function K() {\nthis.x = 1;\nthis.hidden = ${hiddenValue};\n}`, "new K()"],
      ["", `{ x: 1, hidden: ${hiddenValue} }`],
      ["", `{ hidden: ${hiddenValue}, x: 1 }`],
      [`function make() {\nreturn { x: 1, hidden: ${hiddenValue} };\n}`, "make()"],
      [`const make = () => ({ x: 1, hidden: ${hiddenValue} });`, "make()"],
      ["", `{\nx: 1,\nget hidden() {\nreturn tell("got");\n},\n}`],
      [`class K {\nx = 1;\nstatic hidden = ${hiddenValue};\n}`, "K"],
      ["", `[{ x: 1, hidden: ${hiddenValue} }, { x: 2, hidden: ${hiddenValue} }][1]`],
      ["", `Object.assign({ x: 1 }, { hidden: ${hiddenValue} })`],
      ["", `{ x: 1, ...{ hidden: ${hiddenValue} } }`],
    ]);
    const roads = [
      `console.log(Object.keys(o).join());`,
      `console.log(Object.keys(o).length);`,
      `console.log(Object.values(o).length, typeof Object.values(o)[1]);`,
      `console.log(Object.entries(o).length, Object.entries(o)[1][0]);`,
      `console.log(Object.getOwnPropertyNames(o).join());`,
      `console.log(Reflect.ownKeys(o).length);`,
      `console.log(Object.keys(Object.getOwnPropertyDescriptors(o)).join());`,
      `for (const each in o) console.log(each, typeof o[each]);`,
      `console.log(JSON.stringify(o));`,
      `console.log(JSON.stringify([o]));`,
      `console.log(JSON.stringify({ held: o }));`,
      `console.log(JSON.stringify(o, (name, value) => (typeof value === "function" ? "function" : value)));`,
      `console.log(JSON.stringify(o, null, 1));`,
      `console.log(JSON.stringify(o, [${computedKey()}]));`,
      `console.log(Object.keys({ ...o }).join());`,
      `{\nconst { x, ...rest } = o;\nconsole.log(x, Object.keys(rest).join());\n}`,
      `console.log(Object.keys(Object.assign({}, o)).join());`,
      `console.log(Object.keys(new Proxy(o, {})).join());`,
      `console.log(o);`,
      `console.log([o]);`,
      `console.log(Bun.inspect(o));`,
      `console.log(Bun.deepEquals(o, { x: 1 }), Bun.deepEquals({ x: 1 }, o));`,
      `console.log(new Map(Object.entries(o)).size);`,
      `{\nconst key = ${computedKey()};\nconsole.log(typeof o[key]);\n}`,
      `{\nconst key = ${computedKey()};\nconsole.log(key in o, Object.hasOwn(o, key));\n}`,
      `console.log(typeof Reflect.get(o, ${computedKey()}));`,
      `console.log(typeof o[${computedKey()}]);`,
      `console.log(o.hasOwnProperty(${computedKey()}), o.propertyIsEnumerable(${computedKey()}));`,
      `console.log(Reflect.deleteProperty(o, ${computedKey()}), Object.keys(o).join());`,
      `for (const key of ["x", ${computedKey()}]) console.log(key, typeof o[key]);`,
      `console.log(Object.isFrozen(Object.freeze(o)), Object.keys(o).length);`,
      ...(/=>|tell|get hidden|static/.test(declared + made)
        ? []
        : [`console.log(Object.keys(structuredClone(o)).join());`]),
    ];
    return [
      declared,
      `const o = ${made};`,
      random.chance(0.6) ? `console.log(o.x);` : "",
      ...random.sample(roads, random.pick([1, 1, 1, 2])),
      `console.log(log);`,
    ]
      .filter(Boolean)
      .join("\n");
  };

  const others: (() => string)[] = [
    // A parameter.
    () => `function f(a, unused) {\nreturn a + arguments.length;\n}\nconsole.log(f(1, 2), f(1));`,
    () => `function f(a, unused) {\nreturn arguments[1];\n}\nconsole.log(f(1, 2), f(1));`,
    () => `function f(a, unused) {\nreturn [...arguments].join();\n}\nconsole.log(f(1, 2, 3));`,
    () =>
      `function f(a, unused) {\nreturn Array.prototype.slice.call(arguments, 1).join();\n}\nconsole.log(f(1, 2, 3));`,
    () => `function f(a, unused, alsoUnused) {\nreturn a;\n}\nconsole.log(f(1), f.length);`,
    () => `const f = (a, unused) => a;\nconsole.log(f(1, 2), f.length);`,
    () => `function f(a, unused = tell("default")) {\nreturn a;\n}\nconsole.log(f(1), f(1, 2), f(1, undefined), log);`,
    () =>
      `function f(a, { unused = tell("default") } = {}) {\nreturn a;\n}\nconsole.log(f(1), f(1, { unused: 1 }), log);`,
    () => `function f(a, unused) {\nreturn a;\n}\nconsole.log(f(1, tell("argument")), log);`,
    () =>
      `function f({ a, unused }) {\nreturn a;\n}\nconsole.log(\nf({\na: 1,\nget unused() {\nreturn tell("got");\n},\n}),\nlog,\n);`,
    () =>
      `function f([a, unused]) {\nreturn a;\n}\nfunction* steps() {\ntell("first");\nyield 1;\ntell("second");\nyield 2;\ntell("third");\n}\nconsole.log(f(steps()), log);`,
    () =>
      `function f(a, ...unused) {\nreturn a;\n}\nfunction* steps() {\ntell("first");\nyield 1;\ntell("second");\nyield 2;\n}\nconsole.log(f(...steps()), log);`,
    () =>
      `class K {\nconstructor(a, unused) {\nthis.count = arguments.length;\n}\n}\nconsole.log(new K(1, 2).count, new K().count, K.length);`,
    () => `function f(a, unused) {\nunused = 5;\nreturn arguments[1];\n}\nconsole.log(f(1, 2));`,
    // A result that nobody uses.
    () => `const o = {\nget x() {\nreturn tell("got");\n},\n};\no.x;\nconsole.log(log);`,
    () => `const o = {\nvalueOf() {\nreturn tell("valueOf");\n},\n};\no + 1;\n+o;\no < 1;\nconsole.log(log);`,
    () =>
      'const o = {\ntoString() {\ntell("toString");\nreturn "";\n},\n};\n`${o}`;\nString(o);\no + "";\nconsole.log(log);',
    () =>
      `const o = new Proxy(\n{},\n{\nhas() {\ntell("has");\nreturn true;\n},\nownKeys() {\ntell("ownKeys");\nreturn [];\n},\nget() {\ntell("get");\n},\n},\n);\n"k" in o;\nObject.keys(o);\no.k;\n({ ...o });\nconsole.log(log);`,
    () =>
      `class K {\nconstructor() {\ntell("constructed");\n}\n}\nnew K();\nReflect.construct(K, []);\nconsole.log(log);`,
    () =>
      `function* steps() {\ntell("first");\nyield 1;\ntell("end");\n}\n[...steps()];\nArray.from(steps());\nfor (const each of steps());\nconst [] = steps();\nconsole.log(log);`,
    () => `JSON.stringify({\ntoJSON() {\nreturn tell("toJSON");\n},\n});\nconsole.log(log);`,
    () =>
      `class K {\nstatic [Symbol.hasInstance]() {\ntell("hasInstance");\nreturn true;\n}\n}\n({}) instanceof K;\nconsole.log(log);`,
    () => `function f() {\nreturn tell("returned");\n}\nf();\nvoid f();\nconsole.log(log);`,
    () => `function f() {\nreturn {\nget x() {\nreturn tell("got");\n},\n};\n}\nf().x;\nconsole.log(log);`,
    () =>
      `[3, 1, 2].sort((a, b) => tell("compared") && a - b);\n[1].map(() => tell("mapped"));\n"a".replace(/a/, () => tell("replaced"));\nconsole.log(log);`,
    () =>
      `const o = {\n[Symbol.toPrimitive](hint) {\ntell(hint);\nreturn 1;\n},\n};\n({})[o];\no * 1;\no + "";\nconsole.log(log);`,
    // A variable that nobody reads.
    () => `const unused = tell("initializer");\nconsole.log(log);`,
    () => `const { unused } = {\nget unused() {\nreturn tell("got");\n},\n};\nconsole.log(log);`,
    () => `const { a, ...unused } = {\na: 1,\nget b() {\nreturn tell("got");\n},\n};\nconsole.log(a, log);`,
    () =>
      `class Unused {\nstatic x = tell("static field");\nstatic {\ntell("static block");\n}\n[tell("key")]() {}\n}\nconsole.log(log);`,
    () => `function above() {\ntell("above");\nreturn Object;\n}\nclass Unused extends above() {}\nconsole.log(log);`,
    () =>
      `const unused = { [tell("key")]: tell("value"), ...{\nget x() {\nreturn tell("spread");\n},\n} };\nconsole.log(log);`,
    () => `function tag() {\ntell("tag");\n}\nconst unused = tag\`a\`;\nconsole.log(log);`,
    () => `let unused = 1;\nunused = tell("stored");\nunused += tell("added");\nconsole.log(log);`,
    () => `function f() {\nconst unused = [tell("one"), tell("two")];\nreturn 1;\n}\nconsole.log(f(), log);`,
    () => `for (const unused of [tell("a"), tell("b")]) tell("turn");\nconsole.log(log);`,
    () =>
      `try {\nconst unused = null.x;\nconsole.log("not thrown");\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`,
    () =>
      `try {\nconst unused = missing;\nconsole.log("not thrown");\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`,
    () =>
      `try {\nconsole.log(early);\nconsole.log("not thrown");\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}\nlet early = 1;`,
    // A method or a class that nobody names.
    () => `const o = {\nx: 1,\nhidden() {\nreturn tell("called");\n},\n};\nconsole.log(o[${computedKey()}](), log);`,
    () =>
      `const o = {\nhidden() {\nreturn tell("called");\n},\nalso() {\nreturn tell("also");\n},\n};\nfor (const each in o) o[each]();\nconsole.log(log);`,
    () =>
      `const o = {\nhidden() {\nreturn tell("called");\n},\n};\nfor (const each of Object.values(o)) each();\nconsole.log(log);`,
    () =>
      `class K {\nhidden() {\nreturn tell("called");\n}\n}\nfor (const name of Object.getOwnPropertyNames(K.prototype)) if (name !== "constructor") new K()[name]();\nconsole.log(log);`,
    () => `class K {\nstatic hidden() {\nreturn tell("called");\n}\n}\nconsole.log(K[${computedKey()}](), log);`,
    () =>
      `class K {\nhidden = 7;\n}\nconst o = new K();\nconst second = new o.constructor();\nconsole.log(Object.keys(second).join());`,
    () =>
      `class K {\nhidden = 7;\n}\nconst list = [K];\nconsole.log(Object.keys(new list[0]()).join(), Object.keys(Reflect.construct(list[0], [])).join());`,
    () => `const made = new (class {\nhidden = 7;\n})();\nconsole.log(Object.keys(made).join());`,
    () => `function f() {\nreturn arguments.callee === f;\n}\nconsole.log(f());`,
    () =>
      `const o = {\nthen(resolve) {\ntell("then");\nresolve(1);\n},\n};\nPromise.resolve(o).then(value => console.log(value, log));`,
    () =>
      `class K {\nget hidden() {\nreturn tell("got");\n}\n}\nconst o = new K();\nconsole.log(typeof o[${computedKey()}], log);`,
    () => `class K {\n#kept = tell("private field");\nx = 1;\n}\nconsole.log(Object.keys(new K()).join(), log);`,
  ];

  const leaf = `let log = "";\nexport const used = 1;\nexport const hidden = (() => {\nconsole.log("makes hidden");\nreturn 7;\n})();\nexport function alsoHidden() {\nreturn "called";\n}\nconsole.log("runs leaf");\n`;
  const exported: [string, string][] = [
    ["main.mjs", `import * as ns from "./leaf.mjs";\nconsole.log(ns.used);\nconsole.log(Object.keys(ns).join());`],
    ["main.mjs", `import * as ns from "./leaf.mjs";\nconsole.log(ns.used, ns[${computedKey()}]);`],
    ["main.mjs", `import * as ns from "./leaf.mjs";\nfor (const each in ns) console.log(each, typeof ns[each]);`],
    ["main.mjs", `import * as ns from "./leaf.mjs";\nconsole.log(JSON.stringify(ns), Object.keys({ ...ns }).join());`],
    ["main.mjs", `import { used } from "./leaf.mjs";\nconsole.log(used);`],
    ["main.mjs", `import { used } from "./leaf.mjs";\nconsole.log("the import is not read");`],
    ["main.mjs", `import "./leaf.mjs";\nconsole.log("imported for nothing");`],
    ["main.mjs", `import {} from "./leaf.mjs";\nconsole.log("imported for nothing");`],
    [
      "main.mjs",
      `const ns = await import("./leaf.mjs");\nconsole.log(ns.used, ns[${computedKey()}], ns["also" + "Hidden"]());`,
    ],
    ["main.mjs", `import * as ns from "./leaf.mjs";\nconsole.log(ns);`],
    ["main.mjs", `export * from "./leaf.mjs";\nconsole.log("handed on");`],
    ["main.cjs", `const ns = require("./leaf.mjs");\nconsole.log(ns.used, Object.keys(ns).join());`],
    ["main.cjs", `const ns = require("./leaf.mjs");\nconsole.log(ns.used, ns[${computedKey()}]);`],
    ["main.cjs", `const { used } = require("./leaf.mjs");\nconsole.log(used);`],
    ["main.cjs", `require("./leaf.mjs");\nconsole.log("required for nothing");`],
  ];

  const drawn = random.weighted([
    [5, "a field"],
    [5, "another"],
    [2, "an export"],
  ] as const);
  if (drawn === "an export") {
    const [file, text] = random.pick(exported);
    return {
      file,
      text: `${text}\n`,
      files: { "leaf.mjs": leaf, ...(random.chance(0.2) ? { "package.json": '{ "sideEffects": false }\n' } : {}) },
    };
  }
  const scene = drawn === "a field" ? field() : random.pick(others)();
  const isSloppy = /arguments\.callee/.test(scene) || (!/\bawait\b/.test(scene) && random.chance(0.25));
  const needsHead = /\b(tell|log)\b/.test(scene);
  const place =
    /^(import|export) /m.test(scene) || /let early/.test(scene)
      ? "top"
      : random.pick(["top", "top", "once", "thrice", "method"] as const);
  const whole = {
    top: scene,
    once: `function run() {\n${scene}\n}\nrun();`,
    thrice: `function run() {\n${scene}\n}\nrun();\nrun();\nrun();`,
    method: `const holder = {\nrun() {\n${scene}\n},\n};\nholder.run();`,
  }[place];
  return { file: isSloppy ? "main.cjs" : "main.mjs", text: `${needsHead ? head : ""}${whole}\n` };
}
