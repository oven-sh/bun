// Very small TypeScript programs: an interface, one typed function that takes a member of its parameter and hands it on without looking at it (into a literal, a list, a field, a variable, another typed
// function), and one object that is not what the interface says: a member is missing, or holds another kind of value. The object comes by a road that TypeScript does not follow. No type makes a
// program throw or stop: it prints what plain Bun prints.
//
//   the member       a list of numbers, of texts, a number, a text, a boolean, an object, a function, a pair; alone or beside one or two other members, first or last
//   what is wrong    the member is missing; it holds a fraction, an integer, a text, null, undefined, a list of another kind, an empty list, an object; the keys come in another order; one key more
//   the road         a function from `any`, `as any as`, `JSON.parse`, a type parameter, an element of a list of `any`, `Object.assign`, a JavaScript file with a declaration file beside it
//   handed on        into a literal beside a fraction, a list, a field of a new instance, a variable of the file, a typed function, a pattern in the parameter, a spread, what is returned
//   what is read     another member of the result alone, the member's `typeof`, the whole result; in a loop of one turn, at the top of the file, in a function
//   a sound call     ahead of the odd one, behind it, or none
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const kinds: Record<string, { type: string; sound: string }> = {
    numbers: { type: "number[]", sound: "[1, 2]" },
    fractions: { type: "number[]", sound: "[1.5, 2.5]" },
    texts: { type: "string[]", sound: '["a", "b"]' },
    number: { type: "number", sound: "3" },
    fraction: { type: "number", sound: "0.5" },
    text: { type: "string", sound: '"t"' },
    boolean: { type: "boolean", sound: "true" },
    object: { type: "{ x: number }", sound: "{ x: 1 }" },
    function: { type: "() => number", sound: "() => 1" },
    pair: { type: "[number, string]", sound: '[1, "p"]' },
  };
  // Mostly a type whose honest values are all objects: there a number or a text is furthest from what is expected.
  const kind = random.pick([
    "numbers",
    "numbers",
    "numbers",
    "numbers",
    "fractions",
    "fractions",
    "texts",
    "texts",
    "object",
    "object",
    "function",
    "pair",
    "pair",
    "number",
    "fraction",
    "text",
    "boolean",
  ]);
  const { type, sound } = kinds[kind];
  const others = random.sample(
    [
      ["d", "string", '"s"'],
      ["n", "number", "4"],
      ["k", "boolean", "false"],
      ["l", "number[]", "[7]"],
    ],
    random.pick([0, 1, 1, 2]),
  );
  const isFirst = random.chance(0.4);
  const members = isFirst ? [["b", type, sound], ...others] : [...others, ["b", type, sound]];
  const given = `interface Given {\n${members.map(([name, its]) => `${name}: ${its};`).join("\n")}\n}`;
  const soundObject = `{ ${members.map(([name, , value]) => `${name}: ${value}`).join(", ")} }`;
  const wrongValues = [
    "-1.5",
    "-1.5",
    "7",
    "7",
    '"w"',
    '"w"',
    "true",
    "0.25",
    "2147483648",
    "null",
    "undefined",
    '["z"]',
    "[0.5]",
    "[]",
    "{ y: 2 }",
    "[[1]]",
  ].filter(value => value !== sound);
  const wrong = random.pick([
    "another kind",
    "another kind",
    "another kind",
    "another kind",
    "both",
    "both",
    "both",
    "missing",
    "missing",
    "order",
    "one more",
  ]);
  const value = random.pick(wrongValues);
  const rest = others.map(([name, , its]) => `${name}: ${its}`);
  const odd = {
    missing: `{ ${rest.join(", ")} }`,
    "another kind": `{ ${[...rest, `b: ${value}`].join(", ")} }`,
    // As in the program this family began with: another member is missing, and this one holds another kind.
    both: `{ b: ${value} }`,
    order: `{ ${[`b: ${sound}`, ...rest].reverse().join(", ")}${isFirst ? "" : `, late: 1`} }`,
    "one more": `{ more: 1, ${[...rest, `b: ${random.pick([sound, value])}`].join(", ")} }`,
  }[wrong]!;
  const asJson = (text: string) => text.replace(/(\w+):/g, '"$1":').replace(/undefined/g, "null");
  const road = random.pick([
    "launder",
    "launder",
    "launder",
    "as",
    "parse",
    "parameter",
    "element",
    "assign",
    "file",
    "file",
  ]);
  const isParsable = !/=>/.test(odd);
  const files: Record<string, string> = {};
  let comes: string;
  let head = "";
  if (road === "launder") {
    head = "const launder = (v: any): Given => v;";
    comes = `launder(${odd})`;
  } else if (road === "as") comes = `(${odd} as any as Given)`;
  else if (road === "parse" && isParsable) comes = `(JSON.parse(${JSON.stringify(asJson(odd))}) as Given)`;
  else if (road === "parameter") {
    head = "function cast<T>(v: unknown): T {\nreturn v as T;\n}";
    comes = `cast<Given>(${odd})`;
  } else if (road === "element") comes = `([${odd}] as any[] as Given[])[0]`;
  else if (road === "assign") comes = `(Object.assign({}, ${odd}) as any as Given)`;
  else if (road === "file") {
    files["made.js"] = `export const made = ${odd};\n`;
    files["made.d.ts"] =
      `export declare const made: {\n${members.map(([name, its]) => `${name}: ${its};`).join("\n")}\n};\n`;
    head = 'import { made } from "./made.js";';
    comes = "made";
  } else comes = `(${odd} as any as Given)`;
  const on = random.pick([
    "literal",
    "literal",
    "literal",
    "literal",
    "literal",
    "literal",
    "pattern",
    "typed",
    "returned",
    "list",
    "field",
    "variable",
    "two",
  ]);
  const beside = random.pick(["0.125", "0.125", "1", '"c"', "true"]);
  const besideType = /^[\d.]+$/.test(beside) ? "number" : beside === "true" ? "boolean" : "string";
  const result = `interface Result {\ne: ${type};\nc: ${besideType};\n}`;
  const body = {
    literal: ["function f(p: Given): Result {", `return { e: p.b, c: ${beside} };`, "}"],
    two: ["function f(p: Given): Result {", `const r = { c: ${beside}, e: p.b };`, "return r;", "}"],
    list: [`function f(p: Given): { e: (${type})[]; c: ${besideType} } {`, `return { e: [p.b], c: ${beside} };`, "}"],
    field: [
      `class Kept {\ne: ${type};\nc: ${besideType} = ${beside};\nconstructor(p: Given) {\nthis.e = p.b;\n}\n}`,
      "function f(p: Given): Kept {",
      "return new Kept(p);",
      "}",
    ],
    variable: [
      `let last: ${type};`,
      "function f(p: Given): Result {",
      "last = p.b;",
      `return { e: last, c: ${beside} };`,
      "}",
    ],
    typed: [
      `function make(e: ${type}): Result {\nreturn { e, c: ${beside} };\n}`,
      "function f(p: Given): Result {",
      "return make(p.b);",
      "}",
    ],
    pattern: ["function f({ b }: Given): Result {", `return { e: b, c: ${beside} };`, "}"],
    returned: [
      `function take(p: Given): ${type} {\nreturn p.b;\n}`,
      "function f(p: Given): Result {",
      `return { e: take(p), c: ${beside} };`,
      "}",
    ],
  }[on]!;
  const read = random.pick([
    "console.log(R.c);",
    "console.log(R.c);",
    "console.log(R.c);",
    "console.log(typeof R.e);",
    "console.log(R.c, typeof R.e);",
    "console.log(R);",
    "console.log(JSON.stringify(R));",
    "console.log(R.e === undefined, R.c);",
  ]);
  const where = random.pick(["loop", "loop", "top", "function"]);
  const asked = read.replaceAll("R", "f(odd)");
  const use = {
    loop: `for (let i = 0; i < 1; i++) ${asked}`,
    top: asked,
    function: `function look(): void {\n${asked}\n}\nlook();`,
  }[where]!;
  const soundCall = random.pick(["ahead", "ahead", "ahead", "behind", "none", "printed"]);
  const text = [
    head.startsWith("import") ? head : "",
    result,
    given,
    ...body,
    soundCall === "ahead" ? `f(${soundObject});` : soundCall === "printed" ? `console.log(f(${soundObject}).c);` : "",
    head.startsWith("import") ? "" : head,
    `const odd = ${comes};`,
    use,
    soundCall === "behind" ? `console.log(f(${soundObject}).c);` : "",
    "export {};",
  ]
    .filter(Boolean)
    .join("\n");
  return { file: "main.ts", text: text + "\n", files };
}
