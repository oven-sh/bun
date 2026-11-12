// An operator over two values: the operator, times where its left operand comes from, times the two kinds of values that arrive there, times what is done with the result, times the loop around it.
// The right operand is a constant, a parameter, the counter of the loop or an element in turn.
//
//   bun write-operator-use-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<operator>--<source>--<values>--<use>--<loop>.mjs or .ts
//   bun write-operator-use-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `a` and `b` are the operands.
const operators: [name: string, text: string][] = [
  ["less", "a < b"],
  ["at-most", "a <= b"],
  ["greater", "a > b"],
  ["at-least", "a >= b"],
  ["same", "a === b"],
  ["not-same", "a !== b"],
  ["equal", "a == b"],
  ["not-equal", "a != b"],
  ["plus", "a + b"],
  ["minus", "a - b"],
  ["times", "a * b"],
  ["over", "a / b"],
  ["remainder", "a % b"],
  ["power", "a ** b"],
  ["and", "a & b"],
  ["or", "a | b"],
  ["exclusive-or", "a ^ b"],
  ["left", "a << b"],
  ["right", "a >> b"],
  ["right-unsigned", "a >>> b"],
  ["both", "a && b"],
  ["either", "a || b"],
  ["or-else", "a ?? b"],
  ["not", "!a"],
  ["negated", "-a"],
  ["number", "+a"],
  ["complement", "~a"],
  ["typeof", "typeof a"],
  ["void", "void a"],
  ["is", "Object.is(a, b)"],
  ["most", "Math.max(a, b)"],
  ["multiplied", "Math.imul(a, b)"],
  ["whole", "Math.trunc(a)"],
  ["text", "String(a)"],
  ["template", "`${a}|${b}`"],
  ["chosen", "a ? b : 7"],
  ["is-number", "Number.isInteger(a)"],
  ["size", "a?.length"],
];
// How the left operand is read; `@` is a value of the two kinds in turn.
const sources: [name: string, before: string, text: string][] = [
  ["parameter", "", "given"],
  ["local", "let held = given;", "held"],
  ["changed", "let held = first;", "held"],
  ["field", "const o = { x: given, y: 1 };", "o.x"],
  ["added-field", "const o = {};\no.x = given;", "o.x"],
  ["deleted-field", "const o = { x: given, y: 1 };\nif (n > 3) delete o.x;", "o.x"],
  ["element", "const l = [given, first];", "l[i & 1]"],
  ["past-the-end", "const l = [given, first];", "l[i]"],
  ["of-the-file", "", "values[i % values.length]"],
  ["destructured", "const { x, y } = { x: given, y: first };", "(i & 1 ? x : y)"],
  ["result", "", "pass(given)"],
  ["default", "", "orElse(i & 1 ? given : undefined)"],
  ["captured", "const read = () => given;", "read()"],
  ["map", "const m = new Map([[0, given], [1, first]]);", "m.get(i)"],
  ["merged", "let held = first;\nif (n > 2) held = given;", "held"],
  ["counter", "", "i"],
];
const values: [name: string, first: string, second: string][] = [
  ["ints", "3", "-2"],
  ["int-and-double", "3", "2.5"],
  ["doubles", "0.5", "-1.25"],
  ["zeros", "0", "-0"],
  ["large-ints", "2147483647", "-2147483648"],
  ["large-doubles", "4294967296", "9007199254740993"],
  ["not-a-number", "NaN", "Infinity"],
  ["int-and-nothing", "3", "undefined"],
  ["double-and-null", "2.5", "null"],
  ["nothing", "undefined", "null"],
  ["booleans", "true", "false"],
  ["texts", '"b"', '"ab"'],
  ["text-and-int", '"12"', "12"],
  ["empty-text", '""', '"0"'],
  ["objects", "{ valueOf() { return 4; } }", '{ toString() { return "t"; } }'],
  ["lists", "[2]", "[]"],
  ["int-and-object", "1", "{ x: 1 }"],
  ["large-integers", "3n", "-7n"],
];
const uses: [name: string, text: string][] = [
  ["condition", "if (@) r++;"],
  ["value", "last = @;"],
  ["summed", "r += Number(@) || 0;"],
  ["kept", "out.push(@);"],
  ["returned-early", "if (@) return [r, i, show(last)].join();"],
  ["left-loop", "r++;\nif (@) break;"],
  ["negated", "if (!(@)) r += 2;"],
  ["compared", "if ((@) === true) r += 3;"],
  ["text", 'text += (@) + ",";'],
  ["next-left", 'last = @;\nif (typeof last === "number") r = last;'],
];
const loops: [name: string, text: string][] = [
  ["up", "for (let i = 0; i < n; i++) {\n@\n}"],
  ["down", "for (let i = n; --i >= 0; ) {\n@\n}"],
  ["inner", "for (let k = 0; k < 2; k++) {\n  for (let i = 3; i >= 0; i--) {\n@\n  }\n}"],
  ["do", "let i = 0;\ndo {\n@\n} while (++i < n);"],
  ["list", "for (const i of [0, 1, 2]) {\n@\n}"],
  ["once", "const i = n & 1;\nfor (;;) {\n@\n  break;\n}"],
];
const total = operators.length * sources.length * values.length * uses.length * loops.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const operator = pick(operators);
  const source = pick(sources);
  const value = pick(values);
  const use = pick(uses);
  const loop = pick(loops);
  const others = [values[(cell * 5 + 1) % values.length], values[(cell * 13 + 6) % values.length]];
  const isTyped = cell % 5 === 3;
  const any = isTyped ? ": any" : "";
  const typed = (text: string) => (isTyped ? text.replace(/\b(let|const) (held|o|l|m) = /g, "$1 $2: any = ").replace("const read = ()", "const read = (): any") : text); // prettier-ignore
  const rights = [value[2], "second", "i", "values[0]"];
  const right = rights[Math.floor(cell / 3) % rights.length];
  const asked = operator[1].replaceAll(/\ba\b/g, "@left@").replaceAll(/\bb\b/g, () => (isTyped && /^[\d"'n\[{tf-]/.test(right) ? `(${right} as any)` : right.startsWith("{") ? `(${right})` : right.startsWith("-") ? `(${right})` : right)).replaceAll("@left@", isTyped && source[0] === "counter" ? "(i as any)" : source[2]); // prettier-ignore
  const step = [
    ...use[1].replaceAll("@", () => asked).split("\n"),
    ...(source[0] === "changed" ? ["held = i & 1 ? given : first;"] : []),
  ];
  const work = [
    `function work(given${any}, first${any}, second${any}, n${isTyped ? ": number" : ""})${any} {`,
    `  let r${any} = 0;`,
    `  let last${any};`,
    '  let text = "";',
    `  const out${any} = [];`,
    ...typed(source[1]).split("\n").filter(line => line).map(line => "  " + line),
    ...loop[1].replace("@", () => step.map(line => "  " + line).join("\n")).split("\n").map(line => "  " + line),
    "  return [r, show(last), text, out.map(show).join()].join(\"|\");",
    "}",
  ]; // prettier-ignore
  const ask = (call: string) => ["try {", `  console.log(${call});`, "} catch (error) {", `  console.log("threw", ${isTyped ? "(error as any)" : "error"}?.name);`, "}"]; // prettier-ignore
  const lines = [
    `const values${any} = [${value[1]}, ${value[2]}];`,
    `function show(value${any})${isTyped ? ": string" : ""} {`,
    '  return Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? "object" : typeof value === "bigint" ? value + "n" : String(value);',
    "}",
    `const pass = (value${any})${any} => value;`,
    `function orElse(value${any} = ${value[1]})${any} {\n  return value;\n}`,
    ...work,
    ...(cell % 3 === 1 &&
    [value[1], value[2]].every(one => /^(-?\d+(\.\d+)?|"[^"\\]*"|true|false|null)$/.test(one) && one !== "-0")
      ? [
          `for (const [one, other] of JSON.parse(${JSON.stringify(`[[${value[1]}, ${value[2]}], [${value[2]}, ${value[1]}], [${value[1]}, ${value[1]}]]`)})${isTyped ? " as any[][]" : ""}) {`,
          ...ask("work(one, other, other, 4)").map(line => "  " + line),
          "}",
        ]
      : []),
    ...ask(`work(${value[1]}, ${value[2]}, ${value[2]}, 4)`),
    ...ask(`work(${value[2]}, ${value[1]}, ${value[1]}, 3)`),
    ...(cell % 3 ? others.flatMap(other => ask(`work(${other[1]}, ${value[1]}, ${other[2]}, 5)`)) : []),
    ...(isTyped ? ["export {};"] : []),
  ];
  return { name: `${operator[0]}--${source[0]}--${value[0]}--${use[0]}--${loop[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
