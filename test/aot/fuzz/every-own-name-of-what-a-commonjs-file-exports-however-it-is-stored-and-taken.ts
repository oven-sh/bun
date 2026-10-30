// Small programs of two or three files. A CommonJS file lays a few names on what it exports, and another file takes them and says which names it finds and what they hold.
//
//   the names      every name of `Object.prototype`, `default`, `__esModule`, `then`, `0`, a symbol, and ordinary ones
//   laid on        `exports`, a literal, an instance of a class or of a function, an object without a prototype, a copy of parsed text
//   stored by      `exports.x =`, a member of the literal, a definition that is enumerable or not, a getter, `Object.assign`, a loop over the keys of another object
//   beside         nothing, a store or a definition under a text that only the run knows, a definition on an object that only the run knows, `delete`, `Object.freeze` and its kin,
//                  another prototype, a global that holds the object, seventy more names
//   taken by       `import()`, `import * as`, an import of the names, of the default, `export *` in a file between, `require`
//
// With `handedOn`, many of the stores stand under an `if`, in an arm of a conditional expression, behind `&&`, in a function, a loop, a `switch` or a `try`, and most programs take the names
// through getters of a second CommonJS file, as compilers emit them, over one or two ES modules that hand the names on.
import type { Random } from "./random";

const namesOfObjectPrototype = [
  "constructor",
  "toString",
  "toLocaleString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "__proto__",
];
const namesWithAMeaning = ["default", "__esModule", "then", "0"];
const ordinaryNames = ["one", "hidden", "three"];

const isIdentifier = (name: string) => /^[A-Za-z_$][\w$]*$/.test(name);
const member = (holder: string, name: string) => (isIdentifier(name) ? `${holder}.${name}` : `${holder}[${name}]`);
const keyInLiteral = (name: string) =>
  name === "__proto__" ? `["__proto__"]` : isIdentifier(name) ? name : `"${name}"`;

export function generate(
  random: Random,
  handedOn = false,
): { file: string; text: string; files: Record<string, string> } {
  const names = [
    "one",
    ...random.sample(
      namesOfObjectPrototype,
      random.weighted([
        [1, 0],
        [6, 1],
        [2, 2],
      ]),
    ),
    ...random.sample(
      namesWithAMeaning,
      random.weighted([
        [4, 0],
        [4, 1],
        [1, 2],
      ]),
    ),
    ...random.sample(ordinaryNames.slice(1), random.between(0, 2)),
  ];
  // `constructor` is the name that is most often treated apart.
  if (!names.includes("constructor") && random.chance(0.4)) names.push("constructor");
  // Where the names are handed on, most files have few names and their text shows each of them.
  const isPlain = handedOn && random.chance(0.7);
  if (isPlain) names.splice(1, names.length, ...random.sample(ordinaryNames.slice(1), random.between(0, 2)));
  if (isPlain && random.chance(0.2)) names.push(random.pick(namesOfObjectPrototype));
  for (const name of handedOn ? ["default", "__esModule"] : [])
    if (!names.includes(name) && random.chance(0.5)) names.push(name);
  const order = random.shuffled(names);

  const ways = order.map(name =>
    random.weighted([
      [isPlain ? 30 : 6, "assigned"],
      [isPlain ? 0 : 3, "in the literal"],
      [3, "defined"],
      [isPlain ? 0 : 2, "defined for good"],
      [isPlain ? 0 : name === "hidden" ? 12 : 3, "defined and not listed"],
      [isPlain ? 0 : 1, "a getter"],
      [isPlain ? 0 : 1, "a getter that is not listed"],
      [isPlain ? 0 : 2, "Object.assign"],
      [isPlain ? 0 : 2, "a loop"],
    ] as const),
  );
  const hasLiteral = ways.includes("in the literal");
  const made = hasLiteral
    ? "a literal"
    : random.weighted([
        [isPlain ? 120 : 12, "exports"],
        [2, "an instance of a class"],
        [2, "an instance of a function"],
        [1, "an object without a prototype"],
        [1, "a copy of parsed text"],
      ] as const);
  const target =
    made === "exports"
      ? random.weighted([
          [6, "exports"],
          [2, "module.exports"],
          [1, "this"],
          [1, "same"],
        ])
      : made.startsWith("an instance")
        ? "this"
        : "module.exports";

  const value = (name: string, at: number) =>
    name === "__esModule"
      ? random.weighted([
          [6, "true"],
          [1, "false"],
          [1, "1"],
          [1, "undefined"],
        ])
      : name === "then"
        ? String(at + 1)
        : random.weighted([
            [6, String(at + 1)],
            [1, `"text ${at + 1}"`],
            [1, `function () {\n  return ${at + 1};\n}`],
            [1, `{ inner: ${at + 1} }`],
            [1, "undefined"],
          ]);

  const lib: string[] = [];
  if (random.chance(0.5)) lib.push(`"use strict";`);
  const unknownText = random.pick([
    `process.argv.length > 99 ? process.argv[99] : "two"`,
    `Date.now() < 99 ? String(Date.now()) : "two"`,
  ]);
  lib.push(`const unknown = ${unknownText};`);
  if (target === "same") lib.push("const same = exports;");
  if (made === "an object without a prototype") lib.push("module.exports = Object.create(null);");
  if (made === "a copy of parsed text") lib.push(`module.exports = { first: 0, ...JSON.parse('{ "parsed": 80 }') };`);
  if (hasLiteral)
    lib.push(
      `module.exports = { ${order
        .map((name, at) => (ways[at] === "in the literal" ? `${keyInLiteral(name)}: ${value(name, at)}` : ""))
        .filter(text => text)
        .join(", ")} };`,
    );

  const stores: string[] = [];
  order.forEach((name, at) => {
    const held = value(name, at);
    const way = ways[at];
    if (way === "assigned") stores.push(`${member(target, name)} = ${held};`);
    else if (way === "defined")
      stores.push(
        `Object.defineProperty(${target}, "${name}", { value: ${held}, enumerable: true, writable: true, configurable: true });`,
      );
    else if (way === "defined for good")
      stores.push(`Object.defineProperty(${target}, "${name}", { value: ${held}, enumerable: true });`);
    else if (way === "defined and not listed")
      stores.push(
        random.chance(0.5)
          ? `Object.defineProperty(${target}, "${name}", { value: ${held} });`
          : `Object.defineProperty(${target}, "${name}", { value: ${held}, enumerable: false, writable: true, configurable: true });`,
      );
    else if (way === "a getter")
      stores.push(
        `Object.defineProperty(${target}, "${name}", { enumerable: true, get: function () {\n  return ${held};\n} });`,
      );
    else if (way === "a getter that is not listed")
      stores.push(`Object.defineProperty(${target}, "${name}", { get: function () {\n  return ${held};\n} });`);
    else if (way === "Object.assign") stores.push(`Object.assign(${target}, { ${keyInLiteral(name)}: ${held} });`);
    else if (way === "a loop")
      stores.push(
        `const source_${at} = { ${keyInLiteral(name)}: ${held} };\nfor (const key of Object.keys(source_${at})) ${target}[key] = source_${at}[key];`,
      );
  });
  if (handedOn)
    stores.forEach((line, at) => {
      if (line.startsWith("const ") || random.chance(0.4)) return;
      const expression = line.slice(0, -1);
      stores[at] = random.weighted([
        [3, `if (unknown === "two") ${line}`],
        [random.chance(0.2) ? 1 : 0, `if (unknown !== "two") ${line}`],
        [2, `unknown === "two" ? (${expression}) : 0;`],
        [2, `unknown === "two" && (${expression});`],
        [1, `const store_${at} = () => {\n${line}\n};\nstore_${at}();`],
        [1, `for (let turn = 0; turn < 1; turn++) ${line}`],
        [1, `switch (unknown) {\ncase "two":\n${line}\n}`],
        [1, `try {\n${line}\n} finally {\n}`],
      ]);
    });
  if (random.chance(isPlain ? 0.02 : 0.25))
    stores.push(
      `${target}[${random.pick(["Symbol.iterator", "Symbol.toStringTag", `Symbol.for("mark")`])}] = "under a symbol";`,
    );

  const beside = random.sample(
    [
      `${target}[unknown] = 90;`,
      `${target}[unknown] = 90;`,
      `Object.defineProperty(${target}, unknown, { value: 91, enumerable: true });`,
      `Object.defineProperty(${target}, unknown, { value: 92, enumerable: true, writable: true, configurable: true });`,
      `Object.defineProperty(${target}, unknown, { value: 93 });`,
      `Reflect.defineProperty(${target}, unknown, { value: 94, enumerable: true });`,
      `Object.defineProperties(${target}, { [unknown]: { value: 95, enumerable: true } });`,
      `Object.assign(${target}, { [unknown]: 96 });`,
      `Object.defineProperty(unknown === "two" ? ${target} : globalThis[unknown], "__esModule", { value: true });`,
      `Object.defineProperty(unknown === "two" ? ${target} : globalThis[unknown], "late", { value: 97, enumerable: true });`,
      `delete ${member(target, random.pick(order))};`,
      `delete ${target}[unknown];`,
      `Object.freeze(${target});`,
      `Object.seal(${target});`,
      `Object.preventExtensions(${target});`,
      `Object.setPrototypeOf(${target}, null);`,
      `Object.setPrototypeOf(${target}, { above: 98 });`,
      `Object.setPrototypeOf(${target}, { __esModule: true });`,
      `globalThis.held = ${target};`,
      `for (let i = 0; i < 70; i++) ${target}["k" + i] = i;`,
    ],
    random.weighted([
      [isPlain ? 60 : 2, 0],
      [6, 1],
      [3, 2],
      [1, 3],
    ]),
  );
  // What closes the object stands behind the stores in most programs: a store to a closed object throws in strict code.
  for (const line of beside) {
    const closes = /freeze|seal|preventExtensions/.test(line);
    stores.splice(closes && random.chance(0.85) ? stores.length : random.below(stores.length + 1), 0, line);
  }
  const catches =
    beside.some(line => /freeze|seal|preventExtensions/.test(line)) ||
    ways.some(way => way === "defined for good" || way === "defined and not listed");
  const body = catches
    ? stores.map(line =>
        line.startsWith("const ")
          ? line
          : `try {\n${line}\n} catch (error) {\nconsole.log("lib throws", error.name);\n}`,
      )
    : stores;
  if (made === "an instance of a class")
    lib.push(`class Made {\nconstructor() {\n${body.join("\n")}\n}\n}\nmodule.exports = new Made();`);
  else if (made === "an instance of a function")
    lib.push(`function Made() {\n${body.join("\n")}\n}\nmodule.exports = new Made();`);
  else lib.push(...body);
  const files: Record<string, string> = { "lib.cjs": lib.join("\n") + "\n" };

  const asked = [...new Set([...order, "constructor", "default", "two", "late", "above", "toString", "parsed", "k69"])];
  const said = `const said = value =>\n  typeof value === "function" ? "a function" : typeof value === "object" && value !== null ? "an object of " + Reflect.ownKeys(value).map(String).join("+") : String(value);\n`;
  const show = (holder: string) =>
    [
      `console.log("keys", Object.keys(${holder}).join());`,
      `console.log("own", Reflect.ownKeys(${holder}).map(String).join());`,
      ...asked.map(
        name =>
          `console.log(${JSON.stringify(name)}, ${JSON.stringify(name)} in ${holder}, Object.hasOwn(${holder}, ${JSON.stringify(name)}), said(${member(holder, name)}), Object.getOwnPropertyDescriptor(${holder}, ${JSON.stringify(name)})?.enumerable);`,
      ),
      `let listed = "";\nfor (const key in ${holder}) listed += key + " ";\nconsole.log("for in", listed);`,
    ].join("\n") + "\n";

  if (handedOn && random.chance(0.75)) {
    const written = asked.filter(
      name => isIdentifier(name) && !name.startsWith("__") && order.includes(name) && name !== "default",
    );
    // The default of a file without the flag is the whole object.
    if (random.chance(order.includes("__esModule") ? 0.5 : 0.15)) written.push("default");
    const handed = random.sample(written, isPlain ? 3 : random.between(1, 3));
    const byName = `export { ${handed.join(", ")} } from "./lib.cjs";\n`;
    const byStar = `export * from "./lib.cjs";\n${handed.includes("default") ? `export { default } from "./lib.cjs";\n` : ""}`;
    const between = random.weighted([
      [3, "names"],
      [2, "a star"],
      [1, "two modules"],
    ]);
    if (between === "two modules") {
      files["further.mjs"] = random.chance(0.5) ? byName : byStar;
      files["between.mjs"] =
        `export * from "./further.mjs";\n${handed.includes("default") ? `export { default } from "./further.mjs";\n` : ""}`;
    } else files["between.mjs"] = between === "names" ? byName : byStar;
    files["over.cjs"] =
      `"use strict";\n${random.chance(0.8) ? `Object.defineProperty(exports, "__esModule", { value: true });\n` : ""}var below_1 = require("./between.mjs");\n` +
      handed
        .map(
          name =>
            `Object.defineProperty(exports, "${name}", { enumerable: true, get: function () { return below_1.${name}; } });\n`,
        )
        .join("");
    return random.weighted([
      [2, { file: "main.mjs", text: `import * as names from "./over.cjs";\n${said}${show("names")}`, files }],
      [2, { file: "main.mjs", text: `import names from "./over.cjs";\n${said}console.log(said(names));\n`, files }],
      [
        4,
        {
          file: "main.mjs",
          text: `import { ${handed.map(name => `${name} as taken_${name}`).join(", ")} } from "./over.cjs";\n${said}${handed.map(name => `console.log("${name}", said(taken_${name}));`).join("\n")}\n`,
          files,
        },
      ],
      [1, { file: "main.cjs", text: `${said}const names = require("./over.cjs");\n${show("names")}`, files }],
      [1, { file: "main.mjs", text: `${said}const names = await import("./over.cjs");\n${show("names")}`, files }],
    ]);
  }

  const taker = random.weighted([
    [5, "import()"],
    [4, "namespace"],
    [3, "names"],
    [2, "names in a file that is imported in a try"],
    [2, "default"],
    [2, "star"],
    [2, "require"],
    [1, "require and import()"],
  ] as const);
  const bindings = asked.filter(name => order.includes(name) || name === "default" || name === "two");
  const local = (name: string) => `taken_${name.replace(/\W/g, "_")}`;
  const importsNames = (taken: string[]) =>
    `import { ${taken.map(name => `${isIdentifier(name) ? name : `"${name}"`} as ${local(name)}`).join(", ")} } from "./lib.cjs";\n`;
  const showsNames = (taken: string[]) =>
    taken.map(name => `console.log(${JSON.stringify(name)}, said(${local(name)}));`).join("\n") + "\n";

  if (taker === "import()")
    return { file: "main.mjs", text: `${said}const names = await import("./lib.cjs");\n${show("names")}`, files };
  if (taker === "namespace")
    return { file: "main.mjs", text: `import * as names from "./lib.cjs";\n${said}${show("names")}`, files };
  if (taker === "default")
    return { file: "main.mjs", text: `import names from "./lib.cjs";\n${said}${show("names")}`, files };
  if (taker === "require")
    return { file: "main.cjs", text: `${said}const names = require("./lib.cjs");\n${show("names")}`, files };
  if (taker === "require and import()")
    return {
      file: "main.mjs",
      text: `import { createRequire } from "node:module";\n${said}const whole = createRequire(import.meta.url)("./lib.cjs");\nconst names = await import("./lib.cjs");\nconsole.log("the default is what is required", names.default === whole);\n${show("names")}`,
      files,
    };
  if (taker === "star") {
    files["between.mjs"] = `export * from "./lib.cjs";\n`;
    return { file: "main.mjs", text: `import * as names from "./between.mjs";\n${said}${show("names")}`, files };
  }
  if (taker === "names") {
    // One name a program: a name that is not found ends the program before it prints.
    const taken = [random.pick(bindings)];
    return { file: "main.mjs", text: `${importsNames(taken)}${said}${showsNames(taken)}`, files };
  }
  for (const name of bindings)
    files[`takes_${local(name)}.mjs`] = `${importsNames([name])}export const found = ${local(name)};\n`;
  return {
    file: "main.mjs",
    text:
      said +
      bindings
        .map(
          name =>
            `try {\nconsole.log(${JSON.stringify(name)}, said((await import("./takes_${local(name)}.mjs")).found));\n} catch (error) {\nconsole.log(${JSON.stringify(name)}, "is not found:", error.name);\n}`,
        )
        .join("\n") +
      "\n",
    files,
  };
}
