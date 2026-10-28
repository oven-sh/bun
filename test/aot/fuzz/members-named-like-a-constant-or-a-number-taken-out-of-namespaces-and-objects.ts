// Small programs in which an export of a module, or a member of an object, has a name that means something else where it stands alone: `NaN`, `Infinity`, `undefined`, a number, `length`, `default`,
// `__proto__`, `eval`, the name of a built-in. The member is taken out in every way there is, and what was taken is asked what it is. It is what was stored under the name, whatever the name says.
//
//   the name         `NaN`, `Infinity`, `undefined`; "0", "1", "-0", "1.5", "-1"; `length`, `name`, `default`, `constructor`, `prototype`, `__proto__`; `eval`, `arguments`, `null`, `true`, `this`;
//                    `globalThis`, `Object`, `Array`, `Math`
//   who holds it     the namespace of the file itself, of another file, of a file that hands it on, what `import()` gives; a literal, a frozen one, one without a prototype, a parsed text, a class
//   how it is taken  a pattern (in a declaration, an assignment, a parameter; with a default, nested, with a rest, under a computed key), a member, brackets, an import by name, `Reflect.get`, `for in`,
//                    `Object.entries`
//   the value        an object, a list, a text, numbers, a function, null, a boolean
//   the questions    `Array.isArray`, `typeof`, `=== itself`, `Number.isNaN`, `isFinite`, `Object.is`, `== null`, `+ 1`, `> 0`, a member of it; the same function is also asked about another kind
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const plainNames = [
    "NaN",
    "NaN",
    "NaN",
    "Infinity",
    "Infinity",
    "undefined",
    "undefined",
    "length",
    "name",
    "constructor",
    "prototype",
  ];
  const aliasNames = [
    "default",
    "__proto__",
    "eval",
    "arguments",
    "null",
    "true",
    "this",
    "globalThis",
    "Object",
    "Array",
    "Math",
    "typeof",
    "void",
  ];
  const numberNames = ["0", "1", "-0", "1.5", "-1", "4294967295", "1e3", "00"];
  const sort = random.pick(["plain", "plain", "plain", "alias", "number", "number"]);
  const name = random.pick(sort === "plain" ? plainNames : sort === "alias" ? aliasNames : numberNames);
  const isWord = sort !== "number";
  const quoted = JSON.stringify(name);
  const values = [
    "{}",
    "[1]",
    "[1, 2, 3]",
    '"text"',
    "1",
    "1.5",
    "0",
    "() => 1",
    "null",
    "{ inner: 2 }",
    "true",
    "[]",
    '""',
  ];
  const value = random.pick(values);
  const holder = random.pick([
    "itself",
    "itself",
    "another file",
    "another file",
    "another file",
    "handed on",
    "import()",
    "literal",
    "literal",
    "frozen",
    "bare",
    "parsed",
    "class",
  ]);
  const isNamespace = ["itself", "another file", "handed on", "import()"].includes(holder);
  // `export const NaN` where the name may be declared; `export { held as .. }` everywhere.
  const declares = sort === "plain" && random.chance(0.6);
  const exported = declares
    ? `export const ${name} = ${value};`
    : `const held = ${value};\nexport { held as ${isWord ? name : quoted} };`;
  const beside = "export const beside = 5;";
  const key = isWord ? name : quoted;
  const jsonValue = ["() => 1"].includes(value) ? "7" : value.replace(/inner/, '"inner"');
  const source = {
    itself: "ns",
    "another file": "ns",
    "handed on": "ns",
    "import()": "ns",
    literal: "ns",
    frozen: "ns",
    bare: "ns",
    parsed: "ns",
    class: "ns",
  }[holder]!;
  const member = name === "__proto__" ? `["__proto__"]` : key;
  const made = {
    literal: `const ns = { ${member}: ${value}, beside: 5 };`,
    frozen: `const ns = Object.freeze({ ${member}: ${value}, beside: 5 });`,
    bare: `const ns = Object.assign(Object.create(null), { ${member}: ${value}, beside: 5 });`,
    parsed: `const ns = JSON.parse(${JSON.stringify(`{ ${quoted}: ${jsonValue}, "beside": 5 }`)});`,
    class: ["length", "name", "prototype"].includes(name)
      ? `const ns = { ${member}: ${value}, beside: 5 };`
      : `const ns = class {\nstatic ${name === "constructor" ? '["constructor"]' : member} = ${value};\nstatic beside = 5;\n};`,
    itself: 'import * as ns from "./main.mjs";',
    "another file": 'import * as ns from "./other.mjs";',
    "handed on": 'import { ns } from "./between.mjs";',
    "import()": 'const ns = await import("./other.mjs");',
  }[holder]!;
  const canImport = holder === "another file" || holder === "itself";
  const inBrackets = isWord ? quoted : random.pick([quoted, /^(0|[1-9]\d*)$|^1\.5$/.test(name) ? name : quoted]);
  const inPattern = isWord ? name : inBrackets;
  const taken = random.pick([
    `const { ${inPattern}: q } = ${source};`,
    `const { ${inPattern}: q } = ${source};`,
    `const { ${inPattern}: q } = ${source};`,
    `const { ${inPattern}: q, beside: near } = ${source};\nconsole.log(near);`,
    `const { ${inPattern}: q = "by default" } = ${source};`,
    `let q;\n({ ${inPattern}: q } = ${source});`,
    `const q = (({ ${inPattern}: p }) => p)(${source});`,
    `function take({ ${inPattern}: p }) {\nreturn p;\n}\nconst q = take(${source});`,
    `const { [key(${quoted})]: q } = ${source};`,
    `const { beside: near, ...rest } = ${source};\nconst q = rest[${inBrackets}];`,
    `const { beside: near, ...rest } = ${source};\nconst { ${inPattern}: q } = rest;`,
    isWord ? `const q = ${source}.${name};` : `const q = ${source}[${inBrackets}];`,
    `const q = ${source}[${inBrackets}];`,
    `const q = ${source}[key(${quoted})];`,
    `const q = Reflect.get(${source}, ${quoted});`,
    `let q;\nfor (const each in ${source}) if (each === ${quoted}) q = ${source}[each];`,
    `const q = Object.entries(${source}).find(([each]) => each === ${quoted})?.[1];`,
    `const [{ ${inPattern}: q }] = [${source}];`,
    canImport
      ? `import { ${isWord ? name : quoted} as q } from "./${holder === "itself" ? "main" : "other"}.mjs";`
      : `const { ${inPattern}: q } = ${source};`,
    value === "{ inner: 2 }"
      ? `const { ${inPattern}: { inner: q } } = ${source};`
      : `const { ${inPattern}: q } = ${source};`,
  ]);
  const asked = random.sample(
    [
      "console.log(f(q), f([1]));",
      "console.log(f(q), f([1]));",
      "console.log(f([1]), f(q));",
      'console.log(f(q), f("s"), f(2));',
      "console.log(typeof q);",
      "console.log(q === q, q !== q);",
      "console.log(Number.isNaN(q), Number.isFinite(q));",
      'console.log(Object.is(q, Number("x")), Object.is(q, Number.POSITIVE_INFINITY), q === void 0);',
      "console.log(q == null, q === null);",
      "console.log(g(q), g(1));",
      "console.log(q > 0, q < 0, q == 0);",
      "console.log(q?.inner, q?.length);",
      'console.log(String(typeof q === "function" ? q() : q));',
      "console.log(JSON.stringify([q]));",
      "console.log(q ? 1 : 2, !q);",
    ],
    random.pick([1, 2, 3]),
  );
  const globals = holder === "itself" && declares ? "" : "console.log(NaN, Infinity, undefined, typeof globalThis);";
  const all = [taken, ...asked].join("\n");
  const helpers = [
    all.includes("key(") ? 'function key(name) {\nreturn process.argv.length > 99 ? "none" : name;\n}' : "",
    all.includes("f(") ? "function f(v) {\nreturn Array.isArray(v) ? v.length : typeof v;\n}" : "",
    all.includes("g(") ? "function g(v) {\nreturn v + 1;\n}" : "",
  ];
  const listed = random.chance(0.3)
    ? `console.log(Reflect.ownKeys(${source}).filter(each => typeof each === "string" && !["length", "name", "prototype"].includes(each) || each === ${quoted}).join());`
    : "";
  const isImport = /^import /.test(taken);
  const main = [
    isImport ? taken : "",
    /^import /.test(made) ? made : "",
    holder === "itself" ? exported : "",
    holder === "itself" ? beside : "",
    /^import /.test(made) ? "" : made,
    isImport ? "" : taken,
    ...asked,
    listed,
    random.chance(0.5) ? globals : "",
    ...helpers,
  ]
    .filter(Boolean)
    .join("\n");
  const files: Record<string, string> = {};
  if (["another file", "handed on", "import()"].includes(holder)) files["other.mjs"] = `${exported}\n${beside}\n`;
  if (holder === "handed on") files["between.mjs"] = 'export * as ns from "./other.mjs";\n';
  void isNamespace;
  return { file: "main.mjs", text: main + "\n", files };
}
