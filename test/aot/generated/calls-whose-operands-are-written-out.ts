// A call of a function of the language that writes out the structure of what it takes: `Array.from({ length: n }, mapper)`, `Array(n).fill(value)`, `Object.fromEntries([[key, value]])`,
// `new Map([[key, value]])`, `new Set([value])`. A build can make what the text says without making the operand. The same call with the operand in a variable, behind a function or in a field has
// nothing written out. Both print what plain Bun prints, whatever stands in the places of the length, the keys and the values.
// A program has one call and one reader, in a function or in a block, and reads no member of what it has caught: what a build makes of a short program it does not make of a long one.
const lengths = ["0", "3", "-1", "2.5", '"3"', '"x"', "NaN", "2 ** 32", "2 ** 32 - 1 - 4294967290", "undefined", "null", "true", "3n", "{ valueOf() { return 2; } }", "[2]", "Symbol.iterator", "-0"]; // prettier-ignore
const values = ["1", "1.5", '"text"', "undefined", "null", "{}", "[]", "() => 1", "Symbol.iterator", "1n", "NaN", "-0"];
const keys = ['"a"', "1", '"1"', '"__proto__"', '"length"', '"constructor"', "Symbol.iterator", "{ toString() { return \"made\"; } }", "null", "undefined", "1.5", "-0", "NaN", "1n", "[]"]; // prettier-ignore
const mappers = ["(value, index) => index * 2", "(value, index) => ({ index })", "function () { return arguments.length; }", "undefined", "String", "Math.max", "(...all) => all.length", "() => { throw new RangeError(\"thrown\"); }", "5", "null"]; // prettier-ignore

/** Each shape: what stands in its places, the operand that is written out, and the call around it. */
export const shapes: Record<string, { choices: string[]; operand: (choice: string) => string; call: (operand: string) => string }> = {
  "Array.from of a length": { choices: lengths, operand: n => `{ length: ${n} }`, call: o => `Array.from(${o})` },
  "Array.from of a length and a mapper": { choices: lengths, operand: n => `{ length: ${n} }`, call: o => `Array.from(${o}, (value, index) => index + 1)` },
  "Array.from of three and a mapper": { choices: mappers, operand: m => m, call: o => `Array.from({ length: 3 }, ${o})` },
  "Array of a length": { choices: lengths, operand: n => n, call: o => `Array(${o})` },
  "new Array of a length": { choices: lengths, operand: n => n, call: o => `new Array(${o})` },
  "a list of a length that is filled": { choices: lengths, operand: n => n, call: o => `Array(${o}).fill(7)` },
  "a list of three that is filled": { choices: values, operand: v => v, call: o => `Array(3).fill(${o})` },
  "a list that is filled and mapped": { choices: mappers, operand: m => m, call: o => `Array(3).fill(1).map(${o})` },
  "fromEntries of a key": { choices: keys, operand: k => `[[${k}, 1], ["b", 2]]`, call: o => `Object.fromEntries(${o})` },
  "fromEntries of a key twice": { choices: keys, operand: k => `[[${k}, 1], ["b", 2], [${k}, 3]]`, call: o => `Object.fromEntries(${o})` },
  "fromEntries of a value": { choices: values, operand: v => `[["a", ${v}], ["b", ${v}]]`, call: o => `Object.fromEntries(${o})` },
  "fromEntries of a pair that is none": { choices: [...values, '"ab"', "[1]", "[1, 2, 3]"], operand: p => `[["a", 1], ${p}]`, call: o => `Object.fromEntries(${o})` },
  "a Map of a key twice": { choices: keys, operand: k => `[[${k}, 1], ["b", 2], [${k}, 3]]`, call: o => `new Map(${o})` },
  "a Map of a pair that is none": { choices: [...values, '"ab"', "[1]", "[1, 2, 3]"], operand: p => `[["a", 1], ${p}]`, call: o => `new Map(${o})` },
  "a Set of a value twice": { choices: [...values, "0"], operand: v => `[${v}, 0, ${v}]`, call: o => `new Set(${o})` },
}; // prettier-ignore

export const roads = [
  "in the call",
  "a variable",
  "a function",
  "a field",
  "a variable that may hold anything",
] as const;
export const stands = ["in a function", "in a block"] as const;
export const readers: [label: string, read: string][] = [
  ["itself", "made"],
  ["a literal with the length", "({ length: made.length, size: made.size })"],
  ["a literal with the first", "({ first: made[0], a: made.a })"],
  ["the own keys", "Reflect.ownKeys(made).map(String).join()"],
  ["what it has", '[0 in made, "a" in made, Object.hasOwn(made, "length"), Object.hasOwn(made, "__proto__")]'],
  ["its members", "[...(made[Symbol.iterator] ? made : Object.entries(made))].map(each => typeof each).join()"],
  ["its prototype", "[Object.getPrototypeOf(made) === Array.prototype, Object.getPrototypeOf(made) === Object.prototype, made instanceof Map, made instanceof Set]"],
  ["a store", "((made[1] = 5), (made.b = 6), [made[1], made.b, made.length])"],
  ["the sum", "[...(made[Symbol.iterator] ? made : Object.values(made))].reduce((sum, each) => sum + (typeof each === \"number\" ? each : 1), 0)"],
  ["as JSON", "JSON.stringify(made, (key, value) => (typeof value === \"bigint\" ? \"big\" : value))"],
]; // prettier-ignore

export function textOf(
  shape: string,
  choice: number,
  road: (typeof roads)[number],
  stand: (typeof stands)[number],
  reader: number,
): string {
  const { choices, operand, call } = shapes[shape];
  const written = operand(choices[choice]);
  const [before, use] =
    road === "in the call"
      ? ["", written]
      : road === "a variable"
        ? [`const operand = ${written};`, "operand"]
        : road === "a function"
          ? ["", `pass(${written})`]
          : road === "a field"
            ? [`const holder = { held: ${written} };`, "holder.held"]
            : [
                `let operand = ${written}; if (process.argv.length > 5) operand = globalThis[process.argv[5]];`,
                "operand",
              ];
  const made = [before, `const made = ${call(use)};`].filter(Boolean).join("\n  ");
  const [, read] = readers[reader];
  return `${road === "a function" ? "const pass = value => value;\n" : ""}${stand === "in a function" ? `function reader() {\n  ${made}\n  return ${read};\n}\n` : ""}try {
  ${stand === "in a function" ? "console.log(reader());" : `${made}\n  console.log(${read});`}
} catch (error) {
  console.log("THROWS", \`\${error}\`.split(":", 1)[0]);
}
`;
}
