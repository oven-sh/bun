// Small programs over JavaScript that has a declaration file. The file says what a function of the JavaScript is given (`corners`), TypeScript calls it with that, and one call that TypeScript does not check hands it
// something else. The JavaScript uses what it is given in ways that fit several kinds of things, hands it on to a function that it does not export, or keeps it for a later call.
//
//   said       a text, a list, a number, a boolean, an interface, a class, a function, a map, a date, unions, an optional parameter, a pair, bytes, a record, a big integer, literals, a promise, something to walk ..
//   given      in one call: a text, numbers of every kind, a boolean, `null`, `undefined`, a big integer, a symbol, lists, bytes, look-alikes, a boxed text, a proxy, a function, a map, a date, a regular expression
//   unchecked  the call stands in JavaScript; behind `as any`, `// @ts-ignore`, `JSON.parse`, `Reflect.apply`, `apply`; a built-in calls the function (`map`, `then`, `forEach`, `replace`); a package without typings
//              calls it; a name with a wider type; an argument too few
//   the code   a function, an arrow, a method, a static method, the default; an ES module or CommonJS; a package with "types", under @types, or a file of the project beside its declaration file
//   beside it  none, three or ten thousand calls with what the file says, ahead of the odd call, behind it or round it
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

const fitsMany = [
  `given.indexOf("a") + inner(given).length`,
  "given.length + given.slice(1).length",
  "given[0]",
  "given.at(-1)",
  "[...given].length",
  "given.concat(given).length",
  `given.includes("a")`,
  "inner(given).slice(0, 1)",
];
const walks = "{\n  let sum = 0;\n  for (const each of given) sum += each;\n  return sum;\n}";
const said: Record<string, { type: string; honest: string[]; bodies: string[]; isOptional?: true }> = {
  "a text": {
    type: "string",
    honest: [`"a,b,c"`, `"text"`],
    bodies: [...fitsMany, "given + 1", "given.toUpperCase()", "given.charCodeAt(0)"],
  },
  "a list of numbers": {
    type: "number[]",
    honest: ["[1, 2, 3]", "[0.5]"],
    bodies: [...fitsMany, "given.map(each => each + 1).join()", walks, "given[0] + 1"],
  },
  "a list of texts": {
    type: "string[]",
    honest: [`["a", "b"]`],
    bodies: [...fitsMany, "given.join()", "given[0].length"],
  },
  "a number": {
    type: "number",
    honest: ["3", "1.5"],
    bodies: [
      "given + 1",
      "given * 2",
      "given | 0",
      "given.toFixed(1)",
      "given > 2",
      "-given",
      "given % 2",
      "Math.floor(given)",
      "table[given]",
      "`${given}`",
      "inner(given) + inner(given)",
    ],
  },
  "a whole number": {
    type: "number",
    honest: ["3", "2"],
    bodies: [
      "{\n  let sum = 0;\n  for (let index = 0; index < given; index++) sum += index;\n  return sum;\n}",
      "table[given]",
      "given >> 1",
      "given + 1",
      "new Array(given).length",
    ],
  },
  "a boolean": {
    type: "boolean",
    honest: ["true", "false"],
    bodies: ["given ? 1 : 2", "!given", "given === true", "given & 1", "given + 1", "inner(given) || 5"],
  },
  "an interface": {
    type: "{ a: number; b: string }",
    honest: [`{ a: 1, b: "b" }`],
    bodies: [
      "given.a + 1",
      "given.b.length",
      "inner(given).a",
      "Object.keys(given).join()",
      "({ ...given }).a",
      "given.a + given.b",
    ],
  },
  "a class": {
    type: "Thing",
    honest: ["new Thing()"],
    bodies: ["given.a + 1", "given.tag()", "given instanceof Thing", "inner(given).a"],
  },
  "a function": {
    type: "() => number",
    honest: ["() => 1"],
    bodies: ["given() + 1", "inner(given)()", "typeof given", "given.length"],
  },
  "a map": {
    type: "Map<string, number>",
    honest: [`new Map([["a", 1]])`],
    bodies: ["given.size", `given.get("a")`, "[...given.keys()].join()", `given.has("a")`],
  },
  "a date": {
    type: "Date",
    honest: ["new Date(3)"],
    bodies: ["given.getTime()", "given - 0", "+given", "inner(given).getTime() + 1"],
  },
  "a text or a number": {
    type: "string | number",
    honest: [`"text"`, "3"],
    bodies: [`typeof given === "string" ? given.length : given + 1`, "given + 1", "String(given).length"],
  },
  "a text or null": {
    type: "string | null",
    honest: [`"text"`, "null"],
    bodies: ["given === null ? 0 : given.length", "given?.length", `(given ?? "none").length`],
  },
  "an optional number": {
    type: "number",
    honest: ["3", ""],
    bodies: ["(given ?? 5) + 1", "given === undefined ? 0 : given + 1"],
    isOptional: true,
  },
  "a pair": {
    type: "[number, string]",
    honest: [`[1, "b"]`],
    bodies: [
      "given[0] + 1",
      "given[1].length",
      "{\n  const [first, second] = given;\n  return first + second;\n}",
      "given.length",
    ],
  },
  "bytes": {
    type: "Uint8Array",
    honest: ["new Uint8Array([1, 2, 3])"],
    bodies: ["given[0] + 1", "given.length", "given.byteLength", "given.subarray(1).length", walks],
  },
  "a record": {
    type: "Record<string, number>",
    honest: ["{ a: 1, b: 2 }"],
    bodies: ["given.a + 1", `given["b"]`, "Object.values(given).length", "given.missing"],
  },
  "a big integer": {
    type: "bigint",
    honest: ["5n"],
    bodies: ["given + 1n", "given * 2n", "given > 1n", "typeof given", "-given"],
  },
  "one of two texts": {
    type: `"on" | "off"`,
    honest: [`"on"`, `"off"`],
    bodies: [
      `given === "on" ? 1 : 2`,
      `{\n  switch (given) {\n    case "on":\n      return 1;\n    case "off":\n      return 2;\n  }\n  return 3;\n}`,
    ],
  },
  "one of three numbers": {
    type: "0 | 1 | 2",
    honest: ["0", "2"],
    bodies: [
      `["a", "b", "c"][given]`,
      "{\n  switch (given) {\n    case 0:\n      return 10;\n    case 1:\n      return 11;\n    case 2:\n      return 12;\n  }\n  return 13;\n}",
      "table[given] + 1",
    ],
  },
  "an object with a method": {
    type: "{ run(): number }",
    honest: ["{ run: () => 1 }"],
    bodies: ["given.run() + 1", "inner(given).run()"],
  },
  "something to walk": {
    type: "Iterable<number>",
    honest: ["[1, 2]", "new Set([3])"],
    bodies: [walks, "[...given].length", "Math.max(...given)", "Array.from(given).join()"],
  },
  "a regular expression": {
    type: "RegExp",
    honest: ["/a/"],
    bodies: [`given.test("a")`, "given.source", `"a".replace(given, "b")`, "given.lastIndex"],
  },
  "an error": {
    type: "Error",
    honest: [`new Error("text")`],
    bodies: ["given.message.length", "given instanceof Error", "given.name"],
  },
};
export const corners = Object.keys(said);

const odd = [
  `"odd"`,
  `""`,
  "7",
  "-1.5",
  "NaN",
  "-0",
  "2 ** 31",
  "true",
  "null",
  "undefined",
  "10n",
  `Symbol.for("odd")`,
  "[4, 5]",
  `["x"]`,
  "[]",
  `{ a: "z", b: 0 }`,
  `{ length: 2, 0: "p", 1: "q" }`,
  "new Uint8Array([9, 8])",
  `() => "called"`,
  `new Map([["a", "m"]])`,
  "new Date(5)",
  `Object("boxed")`,
  "new Proxy([1], {})",
  "/a/g",
];

export function generate(
  random: Random,
  corner: string,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const { type, honest, bodies, isOptional } = said[corner];
  const body = random.pick(bodies);
  const given = random.pick(odd.filter(each => !honest.includes(each)));
  const isJSON = /^(?:"|-?\d|true|null|\[|\{)/.test(given) && !/n$|\*\*|^-0$/.test(given);
  const unchecked = random.weighted([
    [4, "JavaScript"],
    [2, "as any"],
    [2, "@ts-ignore"],
    [isJSON ? 2 : 0, "JSON.parse"],
    [2, "Reflect.apply"],
    [1, "apply"],
    [2, "map"],
    [1, "then"],
    [1, "forEach"],
    [2, "a package without typings"],
    [2, "a wider name"],
    [1, "an argument too few"],
  ] as const);
  const form = random.weighted([
    [4, "a function"],
    [2, "an arrow"],
    [2, "a method"],
    [1, "a static method"],
    [1, "the default"],
  ] as const);
  const isCommonJS = form !== "the default" && random.chance(0.3);
  const lies = random.weighted([
    [4, "a package"],
    [2, "@types"],
    [3, "a file of the project"],
  ] as const);
  const honestCalls = random.pick([0, 3, 3, 10000]);
  const order = random.pick(["ahead", "behind", "round"] as const);
  const isKept = random.chance(0.25);

  const returns = body.startsWith("{") ? body : `{\n  return ${body};\n}`;
  const parameter = "given";
  const code =
    `function inner(value) {\n  return value;\n}\nconst table = [10, 20, 30];\nconst kept = [];\nclass Thing {\n  a = 1;\n  tag() {\n    return "thing";\n  }\n}\n` +
    (isKept ? `function use(${parameter}) ${returns}\n` : "") +
    {
      "a function": `function take(${parameter}) ${isKept ? "{\n  kept.push(given);\n  return kept.length;\n}" : returns}\n`,
      "an arrow": `const take = ${parameter} => ${isKept ? "kept.push(given)" : body.startsWith("{") ? body : `(${body})`};\n`,
      "a method": `class Taker {\n  take(${parameter}) ${isKept ? "{\n  kept.push(given);\n  return kept.length;\n}" : returns}\n}\n`,
      "a static method": `class Taker {\n  static take(${parameter}) ${isKept ? "{\n  kept.push(given);\n  return kept.length;\n}" : returns}\n}\n`,
      "the default": `function take(${parameter}) ${isKept ? "{\n  kept.push(given);\n  return kept.length;\n}" : returns}\n`,
    }[form] +
    `function later() {\n  return ${isKept ? "use(kept.pop())" : "kept.length"};\n}\n`;
  const main = form === "a method" || form === "a static method" ? "Taker" : "take";
  const exported = ["Thing", "later", ...(form === "the default" ? [] : [main])];
  const handsOn = isCommonJS
    ? exported.map(name => `exports.${name} = ${name};\n`).join("")
    : `export { ${exported.join(", ")} };\n${form === "the default" ? "export default take;\n" : ""}`;
  const signature = `(given${isOptional ? "?" : ""}: ${type}): unknown`;
  const declaration =
    `export declare class Thing {\n  a: number;\n  tag(): string;\n}\nexport declare function later(): unknown;\n` +
    {
      "a function": `export declare function take${signature};\n`,
      "an arrow": `export declare const take: (given${isOptional ? "?" : ""}: ${type}) => unknown;\n`,
      "a method": `export declare class Taker {\n  take${signature};\n}\n`,
      "a static method": `export declare class Taker {\n  static take${signature};\n}\n`,
      "the default": `export default function take${signature};\n`,
    }[form];

  const files: Record<string, string> = {};
  const manifest = (name: string, more: object) =>
    JSON.stringify(
      { name, version: "1.0.0", ...(isCommonJS ? {} : { type: "module" }), main: "./index.js", ...more },
      null,
      2,
    ) + "\n";
  let from = `"taker"`;
  if (lies === "a package") {
    files["node_modules/taker/package.json"] = manifest("taker", { types: "./index.d.ts" });
    files["node_modules/taker/index.js"] = code + handsOn;
    files["node_modules/taker/index.d.ts"] = declaration;
  } else if (lies === "@types") {
    files["node_modules/taker/package.json"] = manifest("taker", {});
    files["node_modules/taker/index.js"] = code + handsOn;
    files["node_modules/@types/taker/package.json"] =
      `{ "name": "@types/taker", "version": "1.0.0", "types": "./index.d.ts" }\n`;
    files["node_modules/@types/taker/index.d.ts"] = declaration;
  } else {
    from = isCommonJS ? `"./taker.cjs"` : `"./taker.mjs"`;
    files[isCommonJS ? "taker.cjs" : "taker.mjs"] = code + handsOn;
    files[isCommonJS ? "taker.d.cts" : "taker.d.mts"] = declaration;
  }

  const imported =
    form === "the default"
      ? `import take, { Thing, later } from ${from};\n`
      : `import { ${main}, Thing, later } from ${from};\n`;
  const callee = form === "a method" ? "taker.take" : form === "a static method" ? "Taker.take" : "take";
  const receiver = form === "a method" ? "taker" : form === "a static method" ? "Taker" : "null";
  const bound =
    form === "a method" || form === "a static method"
      ? `(value: any) => (${callee} as any)(value)`
      : `${callee} as any`;
  const ahead = form === "a method" ? "const taker = new Taker();\n" : "";
  let oddly = "";
  let more = "";
  switch (unchecked) {
    case "JavaScript":
    case "an argument too few":
      files["oddly.mjs"] =
        `${imported.replace(", Thing, later", "").replace("{ Thing, later }", "{}").replace("take, {}", "take")}${ahead}export function oddly() {\n  return ${callee}(${unchecked === "JavaScript" ? given : ""});\n}\n`;
      files["oddly.d.mts"] = "export declare function oddly(): unknown;\n";
      more = `import { oddly } from "./oddly.mjs";\n`;
      oddly = "oddly()";
      break;
    case "as any":
      oddly = `${callee}((${given}) as any)`;
      break;
    case "@ts-ignore":
      oddly = `\n  // @ts-ignore\n  ${callee}(${given})`;
      break;
    case "JSON.parse":
      oddly = `${callee}(JSON.parse(${JSON.stringify(given.replace(/(\w+):/g, '"$1":'))}))`;
      break;
    case "Reflect.apply":
      oddly = `Reflect.apply(${callee}, ${receiver}, [${given}])`;
      break;
    case "apply":
      oddly = `(${callee} as any).apply(${receiver}, [${given}])`;
      break;
    case "map":
      oddly = `[${given}].map(${bound})[0]`;
      break;
    case "then":
      oddly = `await Promise.resolve(${given}).then(${bound})`;
      break;
    case "forEach":
      oddly = `new Set([${given}]).forEach(${bound})`;
      break;
    case "a package without typings":
      files["node_modules/untyped/package.json"] =
        `{ "name": "untyped", "version": "1.0.0", "type": "module", "main": "./index.js" }\n`;
      files["node_modules/untyped/index.js"] = "export function pass(callee, value) {\n  return callee(value);\n}\n";
      files["typings.d.ts"] = `declare module "untyped";\n`;
      more = `import { pass } from "untyped";\n`;
      oddly = `pass(${form === "a method" || form === "a static method" ? `(value: any) => ${callee}(value)` : callee}, ${given})`;
      break;
    case "a wider name":
      files["wide.ts"] =
        `${imported.replace(", Thing, later", "").replace("{ Thing, later }", "{}").replace("take, {}", "take")}${ahead}export const wide = ((value: never) => ${callee}(value)) as (value: unknown) => unknown;\n`;
      more = `import { wide } from "./wide";\n`;
      oddly = `wide(${given})`;
      break;
  }
  const honestly = honestCalls
    ? honest
        .map(
          each =>
            `tell("as the file says", () => {\n  let last;\n  for (let turn = 0; turn < ${honestCalls}; turn++) last = ${callee}(${each});\n  return last;\n});\n` +
            (isKept ? `tell("later", () => later());\n` : ""),
        )
        .join("")
    : "";
  const isAwaited = oddly.includes("await");
  const odds = `${isAwaited ? "await tellLater" : "tell"}("something else", ${isAwaited ? "async " : ""}() => ${oddly});\n${isKept ? `tell("later", () => later());\n` : ""}`;
  const text =
    imported +
    more +
    ahead +
    `function show(value: unknown): string {\n  return typeof value === "function" ? "function" : typeof value === "object" && value !== null ? Object.prototype.toString.call(value) + JSON.stringify(value) : typeof value + " " + String(value) + (Object.is(value, -0) ? " negative" : "");\n}\n` +
    `function tell(label: string, run: () => unknown): void {\n  try {\n    console.log(label, show(run()));\n  } catch (error) {\n    console.log(label, "THROWS", error instanceof Error ? error.constructor.name : typeof error);\n  }\n}\n` +
    (isAwaited
      ? `async function tellLater(label: string, run: () => Promise<unknown>): Promise<void> {\n  try {\n    console.log(label, show(await run()));\n  } catch (error) {\n    console.log(label, "THROWS", error instanceof Error ? error.constructor.name : typeof error);\n  }\n}\n`
      : "") +
    (order === "ahead" ? honestly + odds : order === "behind" ? odds + honestly : honestly + odds + honestly) +
    `console.log("a thing", new Thing().tag());\ntell("at the end", () => later());\n`;
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
  return { file: "main.ts", text, files };
}
