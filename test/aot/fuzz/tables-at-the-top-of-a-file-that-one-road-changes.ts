// Small programs about one `const` at the top of a file that holds a table (an object, a list, a table in a table, a `Map`), one function that reads it, and one change to the table, made by one road.
// `const` says that the name keeps its object, not that the object keeps its members: the function is called ahead of the change and behind it, and the second call sees it. There is one scene,
// and every line is printed at once, by `console.log` itself.
//
//   the table    an object of numbers, of texts, of functions, of lists; a list of numbers, of texts, of objects; a table in a table; a `Map`, a `Set`; a class with static members; an enum as
//                TypeScript writes it out; exported or not
//   the read     a member, a member under a key that is handed in, an element, `length`, a call of a member, a loop over it, `in`, `Object.keys`, `indexOf`, `includes`, JSON, a spread
//   the road     a store under a computed key, `Object.assign`, `Object.defineProperty`, `Reflect.set`, `delete`, a pattern, a loop over its own keys, a method of the table that stores to `this`,
//                another name, an argument of a function, methods of lists that work in place, `length`, another file that imports or requires it, a callback, a job
//   when         between two calls, inside the first call, at the end of the file behind a call that a job makes
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files?: Record<string, string> } {
  type Table = { made: string; reads: string[]; changes: (t: string) => string[] };
  const tables: [number, Table][] = [
    [
      5,
      {
        made: "{ a: 1, b: 2, c: 3 }",
        reads: [
          "TABLE.a",
          "TABLE.a + TABLE.b",
          "TABLE[key]",
          "Object.keys(TABLE).join()",
          '"a" in TABLE',
          "JSON.stringify(TABLE)",
          "Object.values(TABLE).reduce((sum, each) => sum + each, 0)",
          "JSON.stringify({ ...TABLE })",
          "TABLE.d",
        ],
        changes: t => [
          `${t}[["a"][0]] = 10`,
          `${t}.a = 10`,
          `Object.assign(${t}, { a: 10 })`,
          `Object.assign(${t}, { d: 4 })`,
          `Object.defineProperty(${t}, "a", { value: 10 })`,
          `Object.defineProperty(${t}, "a", { get: () => 10 })`,
          `Reflect.set(${t}, "a", 10)`,
          `delete ${t}.a`,
          `({ x: ${t}.a } = { x: 10 })`,
          `[${t}.a] = [10]`,
          `${t}.a++`,
          `${t}.a = "ten"`,
          `${t}.a = 1.5`,
          `Object.setPrototypeOf(${t}, { d: 4 })`,
          `Object.keys(${t}).forEach(name => {\n${t}[name] *= 10;\n})`,
        ],
      },
    ],
    [
      2,
      {
        made: '{ a: "x", b: "y" }',
        reads: ["TABLE.a", "TABLE.a + TABLE.b", "TABLE[key]", "TABLE.a.length", 'TABLE.a === "x"'],
        changes: t => [
          `${t}.a = "changed"`,
          `${t}[["a"][0]] = "changed"`,
          `Object.assign(${t}, { a: "changed" })`,
          `delete ${t}.a`,
          `${t}.a = 5`,
          `${t}.a += "!"`,
        ],
      },
    ],
    [
      3,
      {
        made: '{\na() {\nreturn "first";\n},\n}',
        reads: ["TABLE.a()", "TABLE[key]()", "typeof TABLE.a", "(0, TABLE.a)()"],
        changes: t => [
          `${t}.a = () => "second"`,
          `${t}[["a"][0]] = () => "second"`,
          `Object.assign(${t}, { a: () => "second" })`,
          `Object.defineProperty(${t}, "a", { value: () => "second" })`,
          `delete ${t}.a`,
        ],
      },
    ],
    [
      4,
      {
        made: "[1, 2, 3]",
        reads: [
          "TABLE[0]",
          "TABLE.length",
          "TABLE.join()",
          "TABLE.indexOf(3)",
          "TABLE.includes(1)",
          "TABLE.at(-1)",
          "TABLE[TABLE.length - 1]",
          "Math.max(...TABLE)",
          "TABLE.reduce((sum, each) => sum + each, 0)",
          "JSON.stringify(TABLE)",
        ],
        changes: t => [
          `${t}.push(4)`,
          `${t}.pop()`,
          `${t}.shift()`,
          `${t}.unshift(0)`,
          `${t}.reverse()`,
          `${t}.sort((p, q) => q - p)`,
          `${t}.length = 0`,
          `${t}.length = 1`,
          `${t}[0] = 10`,
          `${t}[5] = 6`,
          `${t}.splice(0, 1)`,
          `${t}.fill(7)`,
          `${t}.copyWithin(0, 1)`,
          `${t}[0] = "one"`,
          `${t}[0] = 1.5`,
          `delete ${t}[0]`,
          `Object.assign(${t}, [9])`,
        ],
      },
    ],
    [
      2,
      {
        made: '["x", "y"]',
        reads: ["TABLE[0]", "TABLE.length", "TABLE.join()", 'TABLE.includes("x")', 'TABLE.indexOf("y")'],
        changes: t => [
          `${t}.push("z")`,
          `${t}.reverse()`,
          `${t}.length = 0`,
          `${t}[0] = "changed"`,
          `${t}.shift()`,
          `${t}.sort().reverse()`,
        ],
      },
    ],
    [
      3,
      {
        made: "{ inner: { a: 1 }, list: [1, 2] }",
        reads: ["TABLE.inner.a", "TABLE.list.length", "TABLE.list[0]", "JSON.stringify(TABLE)", "TABLE.inner[key]"],
        changes: t => [
          `${t}.inner.a = 10`,
          `${t}.inner = { a: 10 }`,
          `${t}.list.push(3)`,
          `${t}.list = []`,
          `${t}.list.length = 0`,
          `delete ${t}.inner.a`,
          `Object.assign(${t}.inner, { a: 10 })`,
          `${t}.list[0] = 10`,
        ],
      },
    ],
    [
      2,
      {
        made: "[{ n: 1 }, { n: 2 }]",
        reads: [
          "TABLE[0].n",
          "TABLE.map(each => each.n).join()",
          "TABLE.find(each => each.n === 2)?.n",
          "TABLE.length",
        ],
        changes: t => [
          `${t}[0].n = 10`,
          `${t}[0] = { n: 10 }`,
          `${t}.reverse()`,
          `${t}.pop()`,
          `${t}.forEach(each => {\neach.n *= 10;\n})`,
          `delete ${t}[0].n`,
        ],
      },
    ],
    [
      2,
      {
        made: 'new Map([\n["a", 1],\n["b", 2],\n])',
        reads: ['TABLE.get("a")', "TABLE.size", 'TABLE.has("a")', "[...TABLE.keys()].join()", "TABLE.get(key)"],
        changes: t => [`${t}.set("a", 10)`, `${t}.delete("a")`, `${t}.clear()`, `${t}.set("c", 3)`],
      },
    ],
    [
      1,
      {
        made: "new Set([1, 2])",
        reads: ["TABLE.has(1)", "TABLE.size", "[...TABLE].join()"],
        changes: t => [`${t}.add(3)`, `${t}.delete(1)`, `${t}.clear()`],
      },
    ],
    [
      2,
      {
        made: "class {\nstatic a = 1;\nstatic read() {\nreturn this.a;\n}\n}",
        reads: ["TABLE.a", "TABLE.read()", "TABLE[key]"],
        changes: t => [
          `${t}.a = 10`,
          `${t}[["a"][0]] = 10`,
          `delete ${t}.a`,
          `Object.assign(${t}, { a: 10 })`,
          `${t}.read = () => "replaced"`,
        ],
      },
    ],
    [
      2,
      {
        made: '(E => {\nE[(E["a"] = 0)] = "a";\nE[(E["b"] = 1)] = "b";\nreturn E;\n})({})',
        reads: ["TABLE.a", "TABLE[0]", "TABLE[TABLE.b]", "Object.keys(TABLE).join()", "TABLE[key]"],
        changes: t => [`${t}.a = 10`, `${t}[0] = "changed"`, `${t}["c"] = 2`, `delete ${t}.b`],
      },
    ],
  ];
  const table = random.weighted(tables);
  const read = random.pick(table.reads);
  const usesKey = /\bkey\b/.test(read);
  const reader = `function reads(${usesKey ? "key" : ""}) {\nreturn ${read};\n}`;
  const shows = `console.log(String(reads(${usesKey ? '"a"' : ""})));`;
  const guarded = (text: string) =>
    `try {\n${text}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;

  const road = random.weighted([
    [5, "named"],
    [3, "another name"],
    [3, "handed"],
    [2, "callback"],
    [2, "this"],
    [4, "another file"],
    [2, "a job"],
    [2, "inside the read"],
  ] as const);
  const target = {
    named: "TABLE",
    "another name": "again",
    handed: "given",
    callback: "TABLE",
    this: "this",
    "another file": "TABLE",
    "a job": "TABLE",
    "inside the read": "TABLE",
  }[road];
  const change = random.pick(table.changes(target));
  const statement = /^[({[]/.test(change) ? `;${change};`.slice(1) : `${change};`;
  const isModule = road === "another file" ? true : random.chance(0.5);
  const file = isModule ? "main.mjs" : "main.cjs";
  const declared = `const TABLE = ${table.made};`;

  if (road === "another file") {
    const byRequire = random.chance(0.3);
    return {
      file: "main.mjs",
      text: `import { reads } from "./table.mjs";\nimport { alter } from "./other.${byRequire ? "cjs" : "mjs"}";\n${guarded(`${shows}\nalter();\n${shows}`)}\n`,
      files: {
        "table.mjs": `export ${declared}\nexport ${reader}\n`,
        ...(byRequire
          ? {
              "other.cjs": `exports.alter = function () {\nconst { TABLE } = require("./table.mjs");\n${statement}\n};\n`,
            }
          : {
              "other.mjs":
                `import ${random.pick(["{ TABLE }", "{ TABLE }", "* as all"])} from "./table.mjs";\nexport function alter() {\n${statement}\n}\n`.replace(
                  /import \* as all([^]*)/,
                  (_, rest: string) => `import * as all${rest.replaceAll("TABLE", "all.TABLE")}`,
                ),
            }),
      },
    };
  }
  const applied = {
    named: statement,
    "another name": `const again = [TABLE][0];\n${statement}`,
    handed: "alter(TABLE);",
    callback: `[0].forEach(() => {\n${statement}\n});`,
    this: `(function () {\n${statement}\n}).call(TABLE);`,
    "a job": `queueMicrotask(() => {\n${statement}\n});`,
    "inside the read": "",
  }[road];
  const alter = road === "handed" ? `function alter(given) {\n${statement}\n}` : "";
  if (road === "inside the read") {
    const both = `let turn = 0;\nfunction reads(${usesKey ? "key" : ""}) {\nconst before = ${read};\nif (turn++ === 0) {\n${statement}\n}\nreturn String(before) + " then " + String(${read});\n}`;
    return { file, text: `${declared}\n${both}\n${guarded(`${shows}\n${shows}`)}\n` };
  }
  if (road === "a job") {
    const waits = isModule
      ? `${shows}\n${applied}\n${shows}\nawait null;\n${shows}`
      : `${shows}\n${applied}\n${shows}\nqueueMicrotask(() => {\n${shows}\n});`;
    return { file, text: `${declared}\n${reader}\n${guarded(waits)}\n` };
  }
  const order = random.pick(["reader first", "reader first", "table last"] as const);
  const head = order === "reader first" ? [declared, reader, alter] : [reader, alter, declared];
  const inAFunction = random.chance(0.4);
  const scene = `${shows}\n${applied}\n${shows}`;
  return {
    file,
    text: `${head.filter(Boolean).join("\n")}\n${inAFunction ? `function run() {\n${scene}\n}\n${guarded("run();")}` : guarded(scene)}\n`,
  };
}
