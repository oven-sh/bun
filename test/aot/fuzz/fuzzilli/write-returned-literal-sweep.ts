// What a function returns out of several arms: how the arm is chosen, times the literals of the arms, times what their fields hold, times what is read off the answer, times the loop around, times where the argument comes from.
//
//   bun write-returned-literal-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<choice>--<literals>--<held>--<read>--<place>--<argument>.ts or .mjs
//   bun write-returned-literal-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `A`, `B` and `C` are the literals.
// What shows most stands more than once.
const choices: [name: string, text: string][] = [
  ["switch", "switch (value) {\n  case 3:\n    return A;\n}\nreturn B;"],
  ["switch-falls", "switch (value) {\n  case 1:\n  case 3:\n    return A;\n  case 2:\n    break;\n}\nreturn B;"],
  ["switch", "switch (value) {\n  case 3:\n    return A;\n}\nreturn B;"],
  [
    "switch-default",
    "switch (value) {\n  case 3:\n    return A;\n  case 1:\n    return C;\n  default:\n    return B;\n}",
  ],
  ["switch-falls", "switch (value) {\n  case 1:\n  case 3:\n    return A;\n  case 2:\n    break;\n}\nreturn B;"],
  [
    "switch-of-kinds",
    'switch (typeof value) {\n  case "number":\n    return A;\n  case "string":\n    return C;\n}\nreturn B;',
  ],
  ["if", "if (value === 3) return A;\nreturn B;"],
  ["if-else", "if (value > 2) {\n  return A;\n} else {\n  return B;\n}"],
  ["three-ifs", "if (value === 3) return A;\nif (value === 1) return C;\nreturn B;"],
  ["choice", "return value === 3 ? A : B;"],
  ["two-choices", "return value === 3 ? A : value === 1 ? C : B;"],
  ["variable", "let made = B;\nif (value === 3) made = A;\nreturn made;"],
  [
    "variable-of-switch",
    "let made;\nswitch (value) {\n  case 3:\n    made = A;\n    break;\n  default:\n    made = B;\n}\nreturn made;",
  ],
  ["or", "return (value === 3 && A) || B;"],
  ["nullish", "const found = value === 3 ? A : undefined;\nreturn found ?? B;"],
  ["tried", "try {\n  if (value === 3) return A;\n  return B;\n} finally {\n  ends++;\n}"],
  ["caught", "try {\n  if (value !== 3) throw value;\n  return A;\n} catch {\n  return B;\n}"],
  ["loop", "for (let at = 0; at < 2; at++) if (value === 3) return A;\nreturn B;"],
  ["helper", "return value === 3 ? first(value) : second(value);"],
  ["table", "return (value === 3 ? first : second)(value);"],
  ["default", "const { made = A } = value === 3 ? {} : { made: B };\nreturn made;"],
];
// `V` is what a field holds in the first literal, `W` in the others.
const literals: [name: string, a: string, b: string, c: string][] = [
  ["list-in-field", "{ a: V, b: [V] }", "{ a: W, b: [W] }", "{ a: 7, b: [8] }"],
  ["list-in-field", "{ a: V, b: [V] }", "{ a: W, b: [W] }", "{ a: 7, b: [8] }"],
  ["two-lists", "{ a: [V], b: [V, 1] }", "{ a: [W], b: [W, 2] }", "{ a: [7], b: [8] }"],
  ["fields", "{ a: V, b: V }", "{ a: W, b: W }", "{ a: 7, b: 8 }"],
  ["other-order", "{ a: V, b: [V] }", "{ b: [W], a: W }", "{ b: [8], a: 7 }"],
  ["more-fields", "{ a: V, b: [V], c: 1 }", "{ a: W, b: [W] }", "{ a: 7, b: [8], d: 2 }"],
  ["nested", "{ a: V, b: { 0: V } }", "{ a: W, b: { 0: W } }", "{ a: 7, b: { 0: 8 } }"],
  ["list", "[V, [V]]", "[W, [W]]", "[7, [8]]"],
  ["instances", "new Pair(V, [V])", "new Pair(W, [W])", "new Pair(7, [8])"],
  ["instance-and-literal", "new Pair(V, [V])", "{ a: W, b: [W] }", "new Pair(7, [8])"],
  ["spread", "{ ...base, a: V, b: [V] }", "{ ...base, b: [W] }", "{ ...base }"],
  ["same-list", "{ a: V, b: shared }", "{ a: W, b: [W] }", "{ a: 7, b: shared }"],
  ["longer-lists", "{ a: V, b: [V, V, 2] }", "{ a: W, b: [] }", "{ a: 7, b: [8] }"],
  ["doubles", "{ a: V, b: [V, 0.5] }", "{ a: 0.5, b: [W] }", "{ a: 1.5, b: [2.5] }"],
  ["getter", "{ a: V, get b() {\n  return [V];\n} }", "{ a: W, b: [W] }", "{ a: 7, b: [8] }"],
];
const helds: [name: string, v: string, w: string][] = [
  ["argument-and-constant", "value", "0"],
  ["argument-and-argument", "value", "value"],
  ["constants", "3", "0"],
  ["sum-and-constant", "value + 1", "0"],
  ["fraction", "value", "0.5"],
  ["text", '"t" + value', '"s"'],
  ["nothing", "value", "undefined"],
  ["parsed", "parsed[2]", "parsed[0]"],
  ["integer", "value | 0", "1"],
  ["counted", "count++", "count"],
];
// `p` is the answer, `F` its first field, `L` its list.
const reads: [name: string, text: string][] = [
  ["sum", "note(F + L[0]);"],
  ["shown-sum", "note([F, show(L), F + L[0]]);"],
  ["sum", "note(F + L[0]);"],
  ["shown-sum", "note([F, show(L), F + L[0]]);"],
  ["same", "note(F === L[0]);"],
  ["twice", "note(L[0] + L[0] - F);"],
  ["compared", "note(F < L[0] ? 1 : F > L[0] ? 2 : 3);"],
  ["pushed", "L.push?.(F);\nnote([L.length, F]);"],
  ["length", "note(L.length * 10 + (F === 3 ? 1 : 2));"],
  ["pattern", "const { a = 4, b: [first, second = 9] = [] } = p;\nnote([a, first, second]);"],
  ["stored", "L[0] = F;\nnote(L[0]);"],
  ["stored-back", "const before = L[0];\nif (Array.isArray(L)) L[0] = 50;\nnote([before, F, L[0]]);"],
  ["added", "total += F;\ntotal += L[0];\nnote(total);"],
  ["greatest", "note(Math.max(F, L[0]));"],
  ["text", 'note(F + ":" + L[0]);'],
  ["json", "note(JSON.stringify(p));"],
  ["kept", "kept.push(p);\nnote(kept[kept.length - 1] === p);"],
  ["two-answers", "const q = made(parsed[1]);\nnote([F, q.a, F === q.a]);"],
  ["product", "note(F * L[0] + F);"],
  ["index", "note(table[F] + (table[L[0]] ?? 5));"],
  ["passed", "note(pass(F) + pass(L[0]));"],
  ["captured", "const ask = () => F + L[0];\nnote(ask());"],
  [
    "switched",
    "switch (F) {\n  case 0:\n    note(L[0] + 1);\n    break;\n  case 3:\n    note(L[0] * 2);\n    break;\n  default:\n    note(L[0]);\n}",
  ],
  ["field-alone", "note(F);"],
  ["element-alone", "note(L[0]);"],
  ["walked", "for (const item of L) note(item === F);"],
];
const places: [name: string, text: string][] = [
  ["late", "for (let r = 0; r < 30; r++) {\n  const p = made(ARG);\n  if (r > 27) {\nREAD\n  }\n}"],
  ["loop", "for (let r = 0; r < 4; r++) {\n  const p = made(ARG);\nREAD\n}"],
  ["once", "const r = 1;\nconst p = made(ARG);\nREAD"],
  ["nest", "for (let s = 0; s < 2; s++) {\n  for (let r = 0; r < 4; r++) {\n    const p = made(ARG);\nREAD\n  }\n}"],
  ["variable", "let p = made(0);\nfor (let r = 0; r < 4; r++) {\n  p = made(ARG);\nREAD\n}"],
  ["function", "const turn = r => {\n  const p = made(ARG);\nREAD\n};\nfor (let r = 0; r < 4; r++) turn(r);"],
  [
    "tried",
    "for (let r = 0; r < 4; r++) {\n  try {\n    const p = made(ARG);\nREAD\n  } catch (error) {\n    note(error.name);\n  }\n}",
  ],
  ["mapped", "const all = [0, 1, 2, 3].map(r => made(ARG));\nfor (const p of all) {\nREAD\n}"],
];
const arguments_: [name: string, text: string][] = [
  ["element", "parsed[3]"],
  ["by-turn", "parsed[r]"],
  ["turn", "r"],
  ["constant", "3"],
  ["hidden", "hidden"],
  ["hidden-sum", "hidden + (r & 1)"],
  ["text-sometimes", 'r === 2 ? "x" : 3'],
];
const total = choices.length * literals.length * helds.length * reads.length * places.length * arguments_.length;

function write(cell: number): { name: string; text: string } {
  let rest = Number((BigInt(cell) * 829348951n) % BigInt(total));
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const choice = pick(choices);
  const read = pick(reads);
  const literal = pick(literals);
  const argument = pick(arguments_);
  const held = pick(helds);
  const place = pick(places);
  const isTyped = cell % 3 === 0;
  const t = (type: string) => (isTyped ? type : "");
  const fill = (text: string) => text.replaceAll(/\bV\b/g, () => held[1]).replaceAll(/\bW\b/g, () => held[2]);
  const object = (text: string) => (text.startsWith("{") ? `(${text})` : text);
  const body = choice[1]
    .replaceAll(/\bA\b/g, () => object(fill(literal[1])))
    .replaceAll(/\bB\b/g, () => object(fill(literal[2])))
    .replaceAll(/\bC\b/g, () => object(fill(literal[3])))
    .replace("let made =", `let made${t(": any")} =`)
    .replace("let made;", `let made${t(": any")};`)
    .replace("const { made =", "const { made =")
    .replace("{} : { made:", isTyped ? "({} as any) : { made:" : "{} : { made:");
  const isList = literal[0] === "list";
  const used = read[1].replaceAll(/\bF\b/g, isList ? "p[0]" : "p.a").replaceAll(/\bL\b/g, isList ? "p[1]" : "p.b");
  const walked = place[1].replaceAll("ARG", () => argument[1]).replaceAll("READ", () => used);
  const typedPlace = isTyped ? walked.replace("turn = r =>", "turn = (r: number) =>").replaceAll("const p = made(", "const p: any = made(").replace("let p = made", "let p: any = made").replace("catch (error)", "catch (error: any)").replace("const q = made", "const q: any = made") : walked; // prettier-ignore
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line); // prettier-ignore
  const lines = [
    `const parsed${t(": any[]")} = JSON.parse("[0.5,1,2,3,4,-0,2147483648,-2147483649]");`,
    'parsed.push("text");',
    'const hidden = JSON.parse("3");',
    `const notes${t(": string[]")} = [];`,
    `const show = (value${t(": any")})${t(": string")} => (typeof value === "function" ? "function" : Array.isArray(value) ? "[" + value.map(show).join() + "]" : typeof value === "object" && value ? "{" + Object.keys(value).map(name => name + ":" + show(value[name])).join() + "}" : Object.is(value, -0) ? "-0" : String(value));`,
    `const note = (value${t(": any")}) => void notes.push(show(value));`,
    `const pass = (value${t(": any")}) => value;`,
    "const table = [10, 20, 30, 40];",
    `const kept${t(": any[]")} = [];`,
    "const shared = [5, 6];",
    "const base = { a: 11, b: [12] };",
    "let ends = 0;",
    "let count = 0;",
    `let total${t(": any")} = 0;`,
    "class Pair {",
    ...(isTyped ? ["  a: any;", "  b: any;"] : []),
    `  constructor(a${t(": any")}, b${t(": any")}) {\n    this.a = a;\n    this.b = b;\n  }\n}`,
    `const first = (value${t(": any")})${t(": any")} => ${object(fill(literal[1]))};`,
    `const second = (value${t(": any")})${t(": any")} => ${object(fill(literal[2]))};`,
    `function made(value${t(": any")})${t(": any")} {`,
    ...indent(body, "  "),
    "}",
    "try {",
    ...indent(typedPlace, "  "),
    `} catch (error${t(": any")}) {`,
    '  notes.push("!" + error.name);',
    "}",
    'console.log(notes.join(" "), ends, count, show(total), shared.join(), kept.length);',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return { name: `${choice[0]}--${literal[0]}--${held[0]}--${read[0]}--${place[0]}--${argument[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
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
