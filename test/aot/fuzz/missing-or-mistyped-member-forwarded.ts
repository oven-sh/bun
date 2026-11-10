// An interface, one typed function that forwards a member of its parameter without inspecting it (into a literal, an
// array, a field, a variable, another typed function), and one object that violates the interface: the member is
// missing or has another type.
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
  // Mostly a type whose honest values are all objects, where a number or a string is furthest from what is expected.
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
    // As in the program this source started from: another member is missing, and this one has another type.
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
