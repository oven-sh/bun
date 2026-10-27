// Small programs in which an object crosses from a file of JavaScript into TypeScript under typings that are right about the object and, in one call, wrong about one member of it (`corners`: what the typings
// say the member is). Typed code does not use the member: it moves it, into a fresh literal, a field, a list, a variable, a parameter, a closure, and keeps what it made. Then everything that was kept is printed.
//
//   the typings   a declaration file beside the JavaScript; a package with "types"; `declare module`; or TypeScript that casts what `JSON.parse` or an untyped function answers
//   the member    said to be a list, an interface, a function, a map, a date, a text, a number, a boolean; in one call it is a fraction, an integer, a text, a boolean, `null`, `undefined`, a big integer, a
//                 symbol, a list, an object, a function, or it is not there
//   the object    in that call it has the members that the typings say, lacks the other one, has one more, or has them the other way round
//   moved into    a fresh literal, ahead of, between or behind fields that nobody stores again; a field of a class; a typed list; a parameter; a pattern; a spread; a closure; a tuple; a static field
//   how deep      the member is a member of the object, or (`isDenser`) of an object that is a member of the object
//   beside it     honest calls, none, a few or ten thousand, ahead of the odd one, behind it or round it, with what the JavaScript makes or with a literal that is written in the TypeScript; the odd call stands alone, in a loop or in a function
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

const said = {
  "a list of numbers": { type: "number[]", honest: "[1, 2]", use: "§.length" },
  "a list of texts": { type: "string[]", honest: `["a", "b"]`, use: "§.join()" },
  "an interface": { type: "Inner", honest: "{ a: 1 }", use: "§.a" },
  "a function": { type: "() => number", honest: "() => 1", use: "§()" },
  "a map": { type: "Map<string, number>", honest: "new Map()", use: "§.size" },
  "a date": { type: "Date", honest: "new Date(0)", use: "§.getTime()" },
  "a text": { type: "string", honest: `"text"`, use: "§.length" },
  "a fraction": { type: "number", honest: "1.5", use: "§ + 1" },
  "an integer": { type: "number", honest: "3", use: "§ | 0" },
  "a boolean": { type: "boolean", honest: "true", use: "!§" },
  "a list or nothing": { type: "number[] | undefined", honest: "[1]", use: "§?.length" },
  "a union of two interfaces": { type: "Inner | { b: string }", honest: `{ b: "b" }`, use: `"a" in §` },
} as const;
export const corners = Object.keys(said) as (keyof typeof said)[];

const odd = [
  "-1.5",
  "7",
  `"odd"`,
  "false",
  "null",
  "undefined",
  "10n",
  `Symbol.for("odd")`,
  "[5]",
  "{ z: 1 }",
  "() => 2",
  "missing",
];

export function generate(
  random: Random,
  corner: (typeof corners)[number],
  isDenser = false,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const { type, honest, use } = said[corner];
  const given = random.pick(odd.filter(each => each !== honest));
  const border = random.weighted([
    [4, "a declaration file"],
    [2, "a package"],
    [1, "declare module"],
    [2, "a cast of an untyped function"],
    [
      given === "10n" ||
      given.startsWith("Symbol") ||
      given.startsWith("()") ||
      given === "undefined" ||
      !/^[["{0-9t]/.test(honest) ||
      honest.startsWith("new")
        ? 0
        : 2,
      "a cast of JSON.parse",
    ],
  ] as const);
  const move = random.pick([
    "a literal, first",
    "a literal, between",
    "a literal, last",
    "a field of a class",
    "a field behind another field",
    "a typed list",
    "a parameter",
    "a pattern",
    "a spread",
    "a closure",
    "a tuple",
    "a static field",
  ] as const);
  const honestCalls = random.pick([0, 1, 3, 10000]);
  const order = random.pick(["ahead", "behind", "round"] as const);
  const isUsed = random.chance(0.5);
  const isInAnotherFile = random.chance(0.4);
  const isHonestMadeHere = random.chance(0.6) || isDenser;
  const isOneFunction = random.chance(0.3) && !isDenser;
  const oddShapeDrawn = random.weighted([
    [3, "alike"],
    [4, "lacks the other member"],
    [1, "has one more member"],
    [1, "the other way round"],
  ] as const);
  const oddCallDrawn = random.weighted([
    [2, "straight"],
    [4, "in a loop of one turn"],
    [2, "in a loop of three turns"],
    [1, "in a function"],
  ] as const);
  // The denser draw: each object has a maker of its own, the odd one lacks the other member and is handed over in a loop, and half of the members lie one level further down.
  const oddShape = isDenser && random.chance(0.8) ? "lacks the other member" : oddShapeDrawn;
  const oddCall = isDenser && oddCallDrawn !== "in a loop of three turns" ? "in a loop of one turn" : oddCallDrawn;
  const isDeep = isDenser && random.chance(0.5);

  const deep = (written: string) => (isDeep ? `{ inner: ${written}, outer: 2 }` : written);
  const object = (member: string) => deep(member === "missing" ? "{ other: 1 }" : `{ list: ${member}, other: 1 }`);
  const list = given === "missing" ? "" : `list: ${given}`;
  const oddObject = deep(
    `{ ${(oddShape === "alike"
      ? [list, "other: 1"]
      : oddShape === "lacks the other member"
        ? [list]
        : oddShape === "has one more member"
          ? ["more: 0", list, "other: 1"]
          : ["other: 1", list]
    )
      .filter(part => part)
      .join(", ")} }`,
  );
  const types = isDeep
    ? `export interface Inner {\n  a: number;\n}\nexport interface Held {\n  list: ${type};\n  other: number;\n}\nexport interface Given {\n  inner: Held;\n  outer: number;\n}\n`
    : `export interface Inner {\n  a: number;\n}\nexport interface Given {\n  list: ${type};\n  other: number;\n}\n`;
  // One function makes both objects, or each has a function of its own.
  const declaration = isOneFunction
    ? `${types}export declare function make(isOdd: boolean): Given;\n`
    : `${types}export declare function make(): Given;\nexport declare function makeOdd(): Given;\n`;
  const maker = isOneFunction
    ? `export function make(isOdd) {\n  return isOdd ? ${oddObject} : ${object(honest)};\n}\n`
    : `export function make() {\n  return ${object(honest)};\n}\nexport function makeOdd() {\n  return ${oddObject};\n}\n`;
  const files: Record<string, string> = {};
  let from = `"./maker.js"`;
  if (border === "a declaration file") Object.assign(files, { "maker.js": maker, "maker.d.ts": declaration });
  if (border === "a package") {
    from = `"a-package"`;
    Object.assign(files, {
      "node_modules/a-package/package.json": `{ "name": "a-package", "version": "1.0.0", "type": "module", "main": "./index.js", "types": "./index.d.ts" }\n`,
      "node_modules/a-package/index.js": maker,
      "node_modules/a-package/index.d.ts": declaration,
    });
  }
  if (border === "declare module") {
    from = `"a-package"`;
    Object.assign(files, {
      "node_modules/a-package/package.json": `{ "name": "a-package", "version": "1.0.0", "type": "module", "main": "./index.js" }\n`,
      "node_modules/a-package/index.js": maker,
      "typings.d.ts": `declare module "a-package" {\n${declaration.replaceAll("export declare function", "export function").replace(/^(?=.)/gm, "  ")}}\n`,
    });
  }
  if (border === "a cast of an untyped function") {
    from = `"./maker"`;
    Object.assign(files, {
      "untyped.js": maker,
      "untyped.d.ts": isOneFunction
        ? "export declare function make(isOdd: boolean): any;\n"
        : "export declare function make(): any;\nexport declare function makeOdd(): any;\n",
      "maker.ts": isOneFunction
        ? `import { make as untyped } from "./untyped.js";\n${types}export function make(isOdd: boolean): Given {\n  return untyped(isOdd);\n}\n`
        : `import { make as untyped, makeOdd as untypedOdd } from "./untyped.js";\n${types}export function make(): Given {\n  return untyped();\n}\nexport function makeOdd(): Given {\n  return untypedOdd();\n}\n`,
    });
  }
  if (border === "a cast of JSON.parse") {
    from = `"./maker"`;
    const text = (written: string) => JSON.stringify(written.replace(/(\w+):/g, '"$1":').replaceAll(" ", ""));
    files["maker.ts"] = isOneFunction
      ? `${types}export function make(isOdd: boolean): Given {\n  return JSON.parse(isOdd ? ${text(oddObject)} : ${text(object(honest))}) as Given;\n}\n`
      : `${types}export function make(): Given {\n  return JSON.parse(${text(object(honest))}) as Given;\n}\nexport function makeOdd(): Given {\n  return JSON.parse(${text(oddObject)}) as Given;\n}\n`;
  }

  const flat = {
    "a literal, first": [
      `interface Made {\n  list: Given["list"];\n  ratio: number;\n}`,
      `return { list: g.list, ratio: 0.125 };`,
      "Made",
      "§.list",
    ],
    "a literal, between": [
      `interface Made {\n  count: number;\n  list: Given["list"];\n  ratio: number;\n}`,
      `return { count: 1, list: g.list, ratio: 0.125 };`,
      "Made",
      "§.list",
    ],
    "a literal, last": [
      `interface Made {\n  ratio: number;\n  list: Given["list"];\n}`,
      `return { ratio: 0.125, list: g.list };`,
      "Made",
      "§.list",
    ],
    "a field of a class": [
      `class Made {\n  list: Given["list"];\n  ratio = 0.125;\n  constructor(g: Given) {\n    this.list = g.list;\n  }\n}`,
      `return new Made(g);`,
      "Made",
      "§.list",
    ],
    "a field behind another field": [
      `class Made {\n  ratio = 0.125;\n  constructor(public list: Given["list"]) {}\n}`,
      `return new Made(g.list);`,
      "Made",
      "§.list",
    ],
    "a typed list": [`type Made = Given["list"][];`, `return [g.list];`, "Made", "§[0]"],
    "a parameter": [
      `interface Made {\n  list: Given["list"];\n  ratio: number;\n}\nfunction take(list: Given["list"], ratio: number): Made {\n  return { list, ratio };\n}`,
      `return take(g.list, 0.125);`,
      "Made",
      "§.list",
    ],
    "a pattern": [
      `interface Made {\n  list: Given["list"];\n  ratio: number;\n}`,
      `const { list } = g;\n  return { list, ratio: 0.125 };`,
      "Made",
      "§.list",
    ],
    "a spread": [
      `interface Made extends Given {\n  ratio: number;\n}`,
      `return { ...g, ratio: 0.125 };`,
      "Made",
      "§.list",
    ],
    "a closure": [`type Made = () => Given["list"];`, `return () => g.list;`, "Made", "§()"],
    "a tuple": [`type Made = [Given["list"], number];`, `return [g.list, 0.125];`, "Made", "§[0]"],
    "a static field": [
      `class Made {\n  static last: Given["list"];\n  ratio = 0.125;\n}`,
      `Made.last = g.list;\n  return new Made();`,
      "Made",
      "Made.last",
    ],
  }[move];
  const made = isDeep
    ? flat.map(text =>
        text
          .replaceAll('Given["list"]', 'Held["list"]')
          .replaceAll("g.list", "g.inner.list")
          .replaceAll("const { list } = g;", "const {\n    inner: { list },\n  } = g;")
          .replaceAll("...g,", "...g.inner,")
          .replaceAll("extends Given", "extends Held"),
      )
    : flat;
  const uses = `${made[0]}\nexport function use(g: Given): Made {\n  ${made[1]}\n}\n`;
  const read = (holder: string) => made[3].replaceAll("§", holder);
  const honestly =
    honestCalls === 0
      ? ""
      : `for (let turn = 0; turn < ${honestCalls}; turn++) kept.push(use(${isHonestMadeHere ? object(honest) : "make(false)"}));\n`;
  const oddly = `${
    oddCall === "straight"
      ? "kept.push(use(make(true)));\n"
      : oddCall === "in a function"
        ? "function once(): void {\n  kept.push(use(make(true)));\n}\nonce();\n"
        : `const odd = make(true);\nfor (let turn = 0; turn < ${oddCall === "in a loop of one turn" ? 1 : 3}; turn++) kept.push(use(odd));\n`
  }${move === "a static field" ? tell("Made.last", "at once") : ""}`;
  function tell(expression: string, label: string) {
    return (
      `console.log("${label}", show(${expression}));\n` +
      (isUsed
        ? `try {\n  console.log("${label}, used", show(${use.replaceAll("§", expression)}));\n} catch (error) {\n  console.log("${label}, used", "THROWS", error instanceof TypeError ? "TypeError" : typeof error);\n}\n`
        : "")
    );
  }
  const body =
    `function show(value: unknown): string {\n  return typeof value === "function" ? "function" : typeof value === "object" && value !== null ? JSON.stringify(value) : typeof value + " " + String(value);\n}\n` +
    `const kept: Made[] = [];\n` +
    (order === "behind" ? oddly + honestly : order === "ahead" ? honestly + oddly : honestly + oddly + honestly) +
    `console.log("kept", kept.length);\n` +
    `for (const each of [kept[0], kept[kept.length >> 1], kept[kept.length - 1]]) {\n${tell(read("each"), "member").replace(/^(?=.)/gm, "  ")}  console.log("whole", typeof each === "function" ? "function" : JSON.stringify(each, (key, value) => (typeof value === "bigint" || typeof value === "symbol" ? String(value) : value)));\n}\n`;
  files["tsconfig.json"] =
    JSON.stringify(
      {
        compilerOptions: {
          target: "esnext",
          module: "preserve",
          moduleResolution: "bundler",
          noEmit: true,
          strict: true,
          types: [],
        },
      },
      null,
      2,
    ) + "\n";
  const calls = (text: string) =>
    isOneFunction
      ? text
      : text
          .replace("import { make", "import { make, makeOdd")
          .replaceAll("make(true)", "makeOdd()")
          .replaceAll("make(false)", "make()");
  if (isInAnotherFile) {
    files["uses.ts"] =
      `import type { Given${isDeep ? ", Held" : ""} } from ${from};\n${uses.replace(/^(interface|class|type) Made/m, "export $1 Made")}`;
    return {
      file: "main.ts",
      text: calls(`import { make } from ${from};\nimport { Made, use } from "./uses";\n${body}`),
      files,
    };
  }
  return {
    file: "main.ts",
    text: calls(
      `import { make, type Given${isDeep ? ", type Held" : ""} } from ${from};\n${uses.replace("export function use", "function use")}${body}`,
    ),
    files,
  };
}
