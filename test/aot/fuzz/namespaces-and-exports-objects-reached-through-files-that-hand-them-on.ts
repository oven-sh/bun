// Small programs of three to five files: one file at the end, one to three files that hand its namespace object or its `module.exports` on, and a first file that reaches it through them alone, holds it
// in one way and asks a few things of it. Unless the draw says otherwise nothing else in the program names the file at the end. Every line is printed at once, by `console.log` itself.
//
//   at the end  an ES module with one to seven exports, a CommonJS file that assigns `module.exports`, fills `exports`, exports a function or says `__esModule`, a JSON file
//   handed on   `export * as ns from`, `import * as ns` and `export { ns }`, under another name, under two names, as the default, under a name that is a text, in an object, in a variable, by a function,
//               `export *`, `export { ns } from`, a namespace inside a namespace; `exports.ns = require(..)`, `module.exports = require(..)`, a getter, a spread, `Object.assign`
//   reached by  `require`, a pattern over what it answers, `module.require`, `createRequire`, `import.meta.require`, `import()`, an import by name, of the namespace, of the default
//   held in     nothing (written out at every use), `var`, `let`, `const`, a member, a literal, an argument, a default of a parameter, a list, a field, a closure, a pattern
//   asked       a member by name, under a key, under a key in a variable; keys, own names, entries, values, `for in`, a spread, a pattern with a rest, JSON, `Object.assign`; `in`, `hasOwn`, `Reflect.has`;
//               `deleteProperty`, `defineProperty`, `Reflect.set`; attributes, the prototype, `Symbol.toStringTag`, frozen, sealed, extensible; functions and classes are called; an export that changes
//   besides     the files say when they run, or say nothing; the file at the end needs the first of the files between; a package that says it has no side effects; a second, direct road
import type { Random } from "./random";

type Step = { name: string; isCalled?: boolean };

export function generate(random: Random): {
  file: string;
  text: string;
  files: Record<string, string>;
} {
  const files: Record<string, string> = {};
  const plainNames = random.chance(0.25);
  const moduleEnd = plainNames ? "js" : "mjs";
  const commonEnd = plainNames ? "js" : "cjs";
  const says = (name: string, chance: number) => (random.chance(chance) ? `console.log("runs ${name}");\n` : "");
  const quoted = (name: string) => (/^\w+$/.test(name) ? name : JSON.stringify(name));

  const leafKind = random.weighted([
    [8, "a module"],
    [2, "an object"],
    [2, "exports"],
    [1, "a function"],
    [1, "marked"],
    [1, "json"],
  ] as const);
  const isLeafModule = leafKind === "a module";
  const leaf = `leaf.${isLeafModule ? moduleEnd : leafKind === "json" ? "json" : commonEnd}`;
  const more = (text: string, chance = 0.3) => (random.chance(chance) ? text : "");
  let leafText = {
    "a module":
      says("leaf", 0.6) +
      "export const c = 1;\n" +
      more("export let count = 0;\nexport function step() {\ncount++;\nreturn count;\n}\n") +
      more("export function who() {\nreturn typeof this;\n}\n") +
      more("export class K {\nk = 1;\n}\n") +
      more('export default "the default";\n') +
      more("export var b = 2;\n") +
      more('const told = "told";\nexport { told as "a text" };\n', 0.15),
    "an object":
      says("leaf", 0.6) +
      `module.exports = {\nc: 1,\n${more("count: 0,\nstep() {\nreturn ++this.count;\n},\n")}${more("who() {\nreturn typeof this;\n},\n")}};\n`,
    exports:
      says("leaf", 0.6) +
      "exports.c = 1;\n" +
      more("exports.count = 0;\nexports.step = function () {\nreturn ++exports.count;\n};\n") +
      more("exports.K = class {\nk = 1;\n};\n"),
    "a function": says("leaf", 0.6) + 'module.exports = function () {\nreturn "called";\n};\nmodule.exports.c = 1;\n',
    marked:
      says("leaf", 0.6) +
      'Object.defineProperty(exports, "__esModule", { value: true });\nexports.c = 1;\nexports.default = "the default";\n',
    json: '{ "c": 1, "d": [1, 2] }\n',
  }[leafKind];

  // The files between.
  const links = random.pick([1, 1, 1, 2, 2, 3]);
  let before = leaf;
  let path: Step[] = [];
  let allModules = isLeafModule;
  let firstLink = "";
  for (let id = 0; id < links; id++) {
    const isModule = random.chance(0.7);
    allModules &&= isModule;
    const name = id === links - 1 ? "lib" : `link${id}`;
    const file = `${name}.${isModule ? moduleEnd : commonEnd}`;
    firstLink ||= file;
    const from = `"./${before}"`;
    const [head, ...rest] = path;
    let text: string;
    if (isModule && !head) {
      const forms: [number, string, Step[]][] = [
        [6, `export * as ns from ${from};`, [{ name: "ns" }]],
        [4, `import * as ns from ${from};\nexport { ns };`, [{ name: "ns" }]],
        [2, `import * as inner from ${from};\nexport { inner as ns };`, [{ name: "ns" }]],
        [2, `import * as ns from ${from};\nexport default ns;`, [{ name: "default" }]],
        [2, `import * as ns from ${from};\nexport const holder = { ns };`, [{ name: "holder" }, { name: "ns" }]],
        [2, `export * as default from ${from};`, [{ name: "default" }]],
        [1, `export * as "a name" from ${from};`, [{ name: "a name" }]],
        [2, `import * as ns from ${from};\nexport function get() {\nreturn ns;\n}`, [{ name: "get", isCalled: true }]],
        [2, `export * from ${from};`, []],
        [1, `import * as ns from ${from};\nexport let held = ns;`, [{ name: "held" }]],
        [1, `import * as ns from ${from};\nexport { ns, ns as again };`, [{ name: "again" }]],
        [1, `export * as ns from ${from};\nexport * as again from ${from};`, [{ name: "again" }]],
        [1, `export * as ns from ${from};\nexport const beside = 1;`, [{ name: "ns" }]],
        ...(before === leaf && !isLeafModule
          ? ([
              [4, `import whole from ${from};\nexport { whole as ns };`, [{ name: "ns" }]],
              [4, `export { default as ns } from ${from};`, [{ name: "ns" }]],
              [2, `export { default } from ${from};`, [{ name: "default" }]],
            ] as [number, string, Step[]][])
          : []),
      ];
      const drawn = random.weighted(forms.map((form): [number, typeof form] => [form[0], form]));
      text = drawn[1];
      path = drawn[2];
    } else if (isModule) {
      const n = quoted(head.name);
      const local = /^\w+$/.test(head.name) && head.name !== "default" ? head.name : "taken";
      const forms: [number, string, Step[]][] = [
        [4, `export { ${n} } from ${from};`, path],
        [3, `export { ${n} as other } from ${from};`, [{ ...head, name: "other" }, ...rest]],
        ...(head.name !== "default" ? ([[3, `export * from ${from};`, path]] as [number, string, Step[]][]) : []),
        [2, `import { ${n} as ${local} } from ${from};\nexport { ${local} as ${n} };`, path],
        [
          2,
          `import { ${n} as inner } from ${from};\nexport const other = inner;`,
          [{ ...head, name: "other" }, ...rest],
        ],
        [3, `export * as outer from ${from};`, [{ name: "outer" }, ...path]],
        [2, `import * as outer from ${from};\nexport { outer };`, [{ name: "outer" }, ...path]],
        [1, `import * as outer from ${from};\nexport default outer;`, [{ name: "default" }, ...path]],
      ];
      const drawn = random.weighted(forms.map((form): [number, typeof form] => [form[0], form]));
      text = drawn[1];
      path = drawn[2];
    } else if (!head) {
      const forms: [number, string, Step[]][] = [
        [4, `exports.ns = require(${from});`, [{ name: "ns" }]],
        [3, `module.exports = { ns: require(${from}) };`, [{ name: "ns" }]],
        [3, `module.exports = require(${from});`, []],
        [
          2,
          `Object.defineProperty(exports, "ns", {\nenumerable: true,\nget() {\nreturn require(${from});\n},\n});`,
          [{ name: "ns" }],
        ],
        [2, `const ns = require(${from});\nmodule.exports.ns = ns;`, [{ name: "ns" }]],
        [1, `module.exports = { ...require(${from}) };`, []],
        [1, `exports.get = () => require(${from});`, [{ name: "get", isCalled: true }]],
      ];
      const drawn = random.weighted(forms.map((form): [number, typeof form] => [form[0], form]));
      text = drawn[1];
      path = drawn[2];
    } else {
      const member = /^\w+$/.test(head.name) ? `.${head.name}` : `[${JSON.stringify(head.name)}]`;
      const forms: [number, string, Step[]][] = [
        [4, `exports${member} = require(${from})${member};`, path],
        [3, `module.exports = require(${from});`, path],
        [
          2,
          `const { ${quoted(head.name)}: taken } = require(${from});\nexports.other = taken;`,
          [{ ...head, name: "other" }, ...rest],
        ],
        [3, `exports.outer = require(${from});`, [{ name: "outer" }, ...path]],
        [2, `module.exports = { ...require(${from}) };`, path],
        [2, `Object.assign(exports, require(${from}));`, path],
      ];
      const drawn = random.weighted(forms.map((form): [number, typeof form] => [form[0], form]));
      text = drawn[1];
      path = drawn[2];
    }
    files[file] = `${says(name, 0.4)}${text}\n`;
    before = file;
  }
  const lib = `"./${before}"`;
  const isLibModule = /^(import|export) /m.test(files[before]);

  // The file at the end needs the first of the files between.
  if (allModules && random.chance(0.2))
    leafText = `import * as back from "./${firstLink}";\n${leafText}export function around() {\nreturn Object.keys(back).join();\n}\n`;
  files[leaf] = leafText;
  if (random.chance(0.15)) files["package.json"] = '{ "sideEffects": false }\n';

  const along = (start: string, steps: Step[]) =>
    steps.reduce(
      (text, step) =>
        text +
        (/^\w+$/.test(step.name) ? `.${step.name}` : `[${JSON.stringify(step.name)}]`) +
        (step.isCalled ? "()" : ""),
      start,
    );
  const isMainModule = random.chance(0.45);
  const [head, ...rest] = path;
  const canBeNamed = !!head && /^\w+$/.test(head.name) && head.name !== "default";
  const required = (loader: string): [number, [string, string]][] => [
    [6, ["", along(`${loader}(${lib})`, path)]],
    [4, [`const lib = ${loader}(${lib});`, along("lib", path)]],
    ...(canBeNamed
      ? ([
          [
            3,
            [`const { ${head.name}: taken } = ${loader}(${lib});`, along("taken" + (head.isCalled ? "()" : ""), rest)],
          ],
        ] as [number, [string, string]][])
      : []),
  ];
  let waits = false;
  const roads: [number, [string, string]][] = isMainModule
    ? [
        ...(head
          ? ([
              [
                5,
                [
                  `import { ${quoted(head.name)} as taken } from ${lib};`,
                  along("taken" + (head.isCalled ? "()" : ""), rest),
                ],
              ],
            ] as [number, [string, string]][])
          : []),
        [4, [`import * as lib from ${lib};`, along("lib", path)]],
        [4, [`const lib = await import(${lib});`, along("lib", path)]],
        [2, ["", along(`(await import(${lib}))`, path)]],
        ...required("require").map(([weight, [first, thing]]): [number, [string, string]] => [
          weight,
          [
            `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n${first}`,
            thing,
          ],
        ]),
        ...required("import.meta.require").map(([weight, road]): [number, [string, string]] => [weight / 3, road]),
        ...(!isLibModule
          ? ([[3, [`import lib from ${lib};`, along("lib", path)]]] as [number, [string, string]][])
          : []),
      ]
    : [
        ...required("require"),
        ...(plainNames
          ? []
          : required("module.require").map(([weight, road]): [number, [string, string]] => [weight / 3, road])),
        [3, [`const lib = await import(${lib});`, along("lib", path)]],
      ];
  // Weights are whole numbers for the draw.
  const [first, thing] = random.weighted(
    roads.map(([weight, road]): [number, [string, string]] => [Math.ceil(weight * 3), road]),
  );
  waits = /await /.test(first + thing);

  const [holds, X, closes] = random.weighted<[string, string, string]>([
    [5, ["", thing, ""]],
    [4, [`var ns = ${thing};`, "ns", ""]],
    [2, [`let ns = ${thing};`, "ns", ""]],
    [3, [`const ns = ${thing};`, "ns", ""]],
    [2, [`const holder = {};\nholder.ns = ${thing};`, "holder.ns", ""]],
    [2, [`const holder = { ns: ${thing} };`, "holder.ns", ""]],
    [3, [`${waits ? "async " : ""}function use(ns) {`, "ns", `}\n${waits ? "await " : ""}use(${thing});`]],
    [
      /await /.test(thing) ? 0 : 1,
      [`${waits ? "async " : ""}function use(ns = ${thing}) {`, "ns", `}\n${waits ? "await " : ""}use();`],
    ],
    [2, [`const list = [${thing}];`, "list[0]", ""]],
    ...(waits
      ? []
      : ([[1, [`class Holds {\nns = ${thing};\n}\nconst holds = new Holds();`, "holds.ns", ""]]] as [
          number,
          [string, string, string],
        ][])),
    ...(waits ? [] : ([[2, [`const get = () => ${thing};`, "get()", ""]]] as [number, [string, string, string]][])),
    [1, [`const [ns] = [${thing}];`, "ns", ""]],
  ]);

  const isRequired = /require\(/.test(first + thing + Object.values(files).join("\n"));
  const asked: [number, string][] = [
    [6, `console.log(${X}.c);`],
    [5, `console.log(${X}.c, Object.keys(${X}).join());`],
    [2, `console.log(${X}["c"]);`],
    [2, `key = "c";\nconsole.log(${X}[key]);`],
    [5, `console.log(Object.keys(${X}).join());`],
    [3, `console.log(Object.keys({ ...${X} }).join());`],
    [3, `console.log(JSON.stringify(${X}));`],
    [3, `console.log("c" in ${X}, "absent" in ${X});`],
    [3, `console.log(Reflect.deleteProperty(${X}, "c"), ${X}.c);`],
    [1, `console.log(Reflect.deleteProperty(${X}, "absent"));`],
    [
      2,
      `console.log(Reflect.defineProperty(${X}, "c", { value: 1 }), Reflect.defineProperty(${X}, "c", { value: 2 }), Reflect.defineProperty(${X}, "more", { value: 1 }));`,
    ],
    [
      2,
      `try {\nObject.defineProperty(${X}, "more", { value: 1 });\nconsole.log("defined", ${X}.more);\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`,
    ],
    [3, `console.log(JSON.stringify(Object.getOwnPropertyDescriptor(${X}, "c")));`],
    [2, `for (const each in ${X}) console.log(each);`],
    [2, `console.log(Object.entries(${X}).length, Object.values(${X}).length);`],
    [2, `console.log(Object.getOwnPropertyNames(${X}).join());`],
    [1, `console.log(Reflect.ownKeys(${X}).length);`],
    [3, `console.log(typeof ${X}.step === "function" ? [${X}.step(), ${X}.count].join() : "no step");`],
    [2, `console.log(typeof ${X}.who === "function" ? ${X}.who() : "no who");`],
    [2, `console.log(typeof ${X}.K === "function" ? new ${X}.K().k : "no class");`],
    [2, `console.log(typeof ${X}.around === "function" ? ${X}.around() : "not around");`],
    [2, `console.log(typeof ${X}.absent, ${X}.absent);`],
    [2, `console.log(String(${X}[Symbol.toStringTag]));`],
    // Plain Bun calls the namespace object of a module extensible once `require` has answered with it.
    [
      2,
      isRequired
        ? `console.log(Object.isFrozen(${X}));`
        : `console.log(Object.isFrozen(${X}), Object.isSealed(${X}), Object.isExtensible(${X}));`,
    ],
    [2, `{\nconst { c, ...others } = ${X};\nconsole.log(c, Object.keys(others).join());\n}`],
    [2, `console.log(typeof ${X}.default, typeof ${X});`],
    [2, `console.log(Object.getPrototypeOf(${X}) === null, Object.getPrototypeOf(${X}) === Object.prototype);`],
    [2, `console.log(Reflect.set(${X}, "c", 5), ${X}.c);`],
    [2, `console.log(Object.hasOwn(${X}, "c"), Object.prototype.hasOwnProperty.call(${X}, "c"));`],
    [1, `console.log(Object.assign({}, ${X}).c);`],
    [2, `console.log(${X} === ${X}, ${X} === ${thing});`],
    [1, `console.log(${X}?.c, ${X}?.absent?.deeper);`],
    [1, `console.log(Reflect.has(${X}, "c"), Reflect.get(${X}, "c"));`],
    [1, `console.log(${X}.b, ${X}["a text"], ${X}.d);`],
  ];
  const reads = Array.from({ length: random.pick([1, 1, 2, 2, 3, 4]) }, () => random.weighted(asked)).join("\n");
  const direct = random.chance(0.2)
    ? isMainModule && isLeafModule
      ? [`import { c as direct } from "./${leaf}";`, "console.log(direct);"]
      : isMainModule
        ? ["", ""]
        : ["", `console.log(require("./${leaf}").c);`]
    : ["", ""];

  const imports = first
    .split("\n")
    .filter(line => line.startsWith("import "))
    .concat(direct[0])
    .filter(Boolean)
    .join("\n");
  const body = [
    first
      .split("\n")
      .filter(line => !line.startsWith("import "))
      .join("\n"),
    /\bkey\b/.test(reads) ? 'let key = "";' : "",
    holds,
    reads,
    closes,
    direct[1],
  ]
    .filter(Boolean)
    .join("\n");
  const inside = random.chance(0.25);
  const text = isMainModule
    ? `${imports ? imports + "\n" : ""}${inside ? `${waits ? "async " : ""}function run() {\n${body}\n}\n${waits ? "await " : ""}run();` : body}\n`
    : waits
      ? `(async () => {\n${body}\n})();\n`
      : inside
        ? `function run() {\n${body}\n}\nrun();\n`
        : `${body}\n`;
  return { file: `main.${isMainModule ? moduleEnd : commonEnd}`, text, files };
}
