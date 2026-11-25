// A closure over a value of the function that made it: what it captures, times what it does with it, times where it is made, times the loop that calls it, times what is done with what it returns.
//
//   bun write-captured-value-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<captured>--<body>--<made>--<loop>--<use>.mjs or .ts
//   bun write-captured-value-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// Lines of the maker and the name that the closure reads; `salt` is the parameter of the maker.
const captured: [name: string, lines: string, read: string, store: string][] = [
  ["parameter", "", "salt", "salt = @"],
  ["constant", "const kept = salt;", "kept", ""],
  ["variable", "let kept = salt;", "kept", "kept = @"],
  ["stored-once-more", "let kept = 0;\nkept = salt;", "kept", "kept = @"],
  ["stored-behind", "let kept = 0;\nlater(() => (kept = salt));", "kept", "kept = @"],
  ["sum", "const kept = salt * 2 + 0.5;", "kept", ""],
  ["whole", "const kept = salt | 0;", "kept", ""],
  ["object", "const held = { x: salt };", "held.x", "held.x = @"],
  ["list", "const held = [salt, 2, 3];", "held[0]", "held[0] = @"],
  ["typed-list", "const held = new Int32Array([salt, 2, 3]);", "held[0]", "held[0] = @"],
  ["other-closure", "let kept = salt;\nconst ask = () => kept++;", "ask()", "kept = @"],
  ["default", "const { kept = 3 } = { kept: salt > 5 ? undefined : salt };", "kept", ""],
  ["two-levels", "const inner = () => salt;\nconst outer = () => inner();", "outer()", ""],
  ["counter-of-a-loop", "let kept = 0;\nfor (let k = 0; k < salt; k++) kept = k;", "kept", "kept = @"],
  ["nothing-first", "let kept;\nif (salt > 1) kept = salt;", "(kept ?? 1)", "kept = @"],
]; // prettier-ignore
// `C` is what is captured, `S(..)` stores it where it can be stored.
const bodies: [name: string, text: string][] = [
  ["adds", "return a + C;"],
  ["adds-and-takes", "a = a + C - C;\nlist[a & 3] = a;\nreturn list[a & 3];"],
  ["multiplies", "return Math.imul(a, C) + b;"],
  ["chooses", "return a > C ? a : C;"],
  ["counts", "S(C + 1);\nreturn C;"],
  ["sums", "S(C + a);\nreturn C * 2;"],
  ["hash", "return (Math.imul(a ^ C, 16777619) + b) >>> 0;"],
  ["index", "return list[(a + C) & 3];"],
  ["stores-in-a-list", "list[C & 3] = a;\nreturn b;"],
  ["leaves", "if (a === C) return b;\nreturn a - C;"],
  ["throws", 'if (a > 4 + C) throw new Error("large");\nreturn C;'],
  ["text", 'return "" + C + a;'],
  ["nothing", "if (a < C) return;\nreturn C;"],
  ["pair", "return { a, c: C };"],
  ["itself", "return a > 0 && a < 9 ? f(a - 1, b) + C : C;"],
];
const mades: [name: string, text: string][] = [
  ["of-the-file", "const f = make(1);\nfunction total(a, b) {\nLOOP\n}"],
  [
    "of-the-file-by-let",
    "let f = make(1);\nfunction total(a, b) {\nLOOP\n}\nif (process.argv.length > 9) f = make(2);",
  ],
  ["in-the-function", "function total(a, b) {\n  const f = make(2);\nLOOP\n}"],
  ["by-the-argument", "function total(a, b) {\n  const f = make(b);\nLOOP\n}"],
  ["two-made", "const fs = [make(1), make(3)];\nfunction total(a, b) {\n  const f = fs[a & 1];\nLOOP\n}"],
  [
    "handed-over",
    "const made = make(4);\nfunction total(a, b) {\n  return inside(a, b, made);\n}\nfunction inside(a, b, f) {\nLOOP\n}",
  ],
  ["in-an-object", "const o = { f: make(5) };\nfunction total(a, b) {\n  const f = (x, y) => o.f(x, y);\nLOOP\n}"],
  [
    "in-a-field",
    "class Holder {\n  f = make(6);\n}\nconst holder = new Holder();\nfunction total(a, b) {\n  const { f } = holder;\nLOOP\n}",
  ],
];
// `USE` is what is done with `f(a, b)`.
const loops: [name: string, text: string][] = [
  ["three", "let x = 0;\nfor (let i = 0; i < 3; i++) {\nUSE\n}\nreturn x;"],
  ["nine", "let x = 0;\nfor (let i = 0; i < 9; i++) {\nUSE\n}\nreturn x;"],
  ["by-the-argument", "let x = 0;\nfor (let i = 0; i < b; i++) {\n  if (i > 6) break;\nUSE\n}\nreturn x;"],
  ["down", "let x = 0;\nfor (let i = 3; --i >= 0; ) {\nUSE\n}\nreturn x;"],
  ["while", "let x = 0;\nlet i = 0;\nwhile (i++ < 4) {\nUSE\n}\nreturn x;"],
  ["inner", "let x = 0;\nfor (let i = 0; i < 2; i++) {\n  for (let j = 0; j < 3; j++) {\nUSE\n  }\n}\nreturn x;"],
  ["over-a-list", "let x = 0;\nfor (const i of [0, 1, 2]) {\nUSE\n}\nreturn x;"],
  ["for-each", "let x = 0;\n[0, 1, 2].forEach(i => {\nUSE\n});\nreturn x;"],
  ["guarded", "let x = 0;\nfor (let i = 0; i < 3; i++) {\n  try {\nUSE\n  } catch {\n    x = -1;\n  }\n}\nreturn x;"],
  ["once", "let x = 0;\nconst i = 1;\nUSE\nreturn x;"],
];
const uses: [name: string, text: string][] = [
  ["sums", "x += f(a, b);"],
  ["exclusive-or", "x ^= f(a, b);"],
  ["keeps", "x = f(a, b);"],
  ["carries", "x = f(x, b);"],
  ["by-the-counter", "x += f(i, b);"],
  ["unsigned", "x = (x ^ f(a, i)) >>> 0;"],
  ["asks", "if (f(a, b)) x += 2;"],
  ["twice", "x = f(f(a, i), b);"],
];
const total = captured.length * bodies.length * mades.length * loops.length * uses.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const held = pick(captured);
  const body = pick(bodies);
  const made = pick(mades);
  const loop = pick(loops);
  const use = pick(uses);
  const isTyped = cell % 4 === 3;
  const isParsed = Math.floor(cell / 8) % 3 !== 0;
  // Programs whose values are numbers alone say so; the others say any.
  const isOfNumbers = isTyped && !["text", "nothing", "pair"].includes(body[0]) && held[0] !== "nothing-first" && use[0] !== "asks"; // prettier-ignore
  const any = isTyped ? (isOfNumbers ? ": number" : ": any") : "";
  const type = isOfNumbers ? "number" : "any";
  const closure = `(a: ${type}, b: ${type}) => ${type}`;
  const typed = (text: string) =>
    isTyped
      ? text
          .replaceAll("function total(a, b)", `function total(a: ${type}, b: ${type}): ${type}`)
          .replaceAll("function inside(a, b, f)", `function inside(a: ${type}, b: ${type}, f: ${closure}): ${type}`)
          .replaceAll("let x = 0", `let x: ${type} = 0`)
          .replaceAll(/\b(let|const) kept( =|;)/g, `$1 kept: ${type}$2`)
          .replaceAll("const held = {", `const held: { x: ${type} } = {`)
          .replaceAll("(x, y) =>", `(x: ${type}, y: ${type}) =>`)
          .replaceAll("const ask = () =>", `const ask = (): ${type} =>`)
          .replaceAll("const { kept = 3 } = {", isOfNumbers ? "const { kept = 3 }: { kept?: number } = {" : "const { kept = 3 }: any = {")
      : text; // prettier-ignore
  const store = (value: string) => (held[3] ? held[3].replace("@", () => value) : `list[0] = ${value}`);
  const inside = body[1].replaceAll(/S\((.*)\);/g, (_, value) => store(value) + ";").replaceAll(/\bC\b/g, () => held[2]).replaceAll("f(a - 1, b)", "itself(a - 1, b)"); // prettier-ignore
  const indent = (lines: string[]) => lines.map(line => "  " + line);
  const calls = inside.includes("itself(");
  const results = isTyped ? `: ${type}` : "";
  const lines = [
    `const list${isTyped ? `: ${type}[]` : ""} = [1, 2, 3, 4];`,
    `const laters${isTyped ? ": (() => void)[]" : ""} = [];`,
    `const later = (f${isTyped ? ": () => any" : ""}) => {\n  laters.push(f);\n};`,
    `function make(salt${any})${isTyped ? `: ${closure}` : ""} {`,
    ...indent(held[1] ? typed(held[1]).split("\n") : []),
    calls ? `  const itself = (a${any}, b${any})${results} => {` : `  return (a${any}, b${any})${results} => {`,
    ...indent(indent((isOfNumbers ? inside.replaceAll(/\blist\[([^\]]*)\]( = )?/g, (all, at, stores) => (stores ? all : `list[${at}]!`)) : inside).split("\n"))), // prettier-ignore
    "  };",
    ...(calls ? ["  return itself;"] : []),
    "}",
    ...typed(made[1])
      .replace("LOOP", () =>
        typed(loop[1])
          .replace("USE", () => "  " + use[1])
          .split("\n")
          .map(line => "  " + line)
          .join("\n"),
      ) // prettier-ignore
      .split("\n"),
    "for (let turn = 0; turn < 2; turn++) {",
    // What the build can read off the text it may lay into the function.
    `  for (const a of ${isParsed ? 'JSON.parse("[0, 1, 2.5, 5, 4294967295, -3]")' : "[0, 1, 2.5, 5, 4294967295, -3]"}${isTyped && isParsed ? " as number[]" : ""})`,
    `    for (const b of ${isParsed ? 'JSON.parse("[0, 3, 2.5]")' : "[0, 3, 2.5]"}${isTyped && isParsed ? " as number[]" : ""}) {`,
    "      try {",
    '        console.log(JSON.stringify(total(a, b)) ?? "nothing");',
    "      } catch (error) {",
    `        console.log("threw", ${isTyped ? "(error as any)" : "error"}?.name);`,
    "      }",
    "    }",
    "  for (const f of laters) f();",
    "}",
    "console.log(list.join());",
    ...(isTyped ? ["export {};"] : []),
  ];
  return { name: `${held[0]}--${body[0]}--${made[0]}--${loop[0]}--${use[0]}${isTyped ? ".ts" : ".mjs"}`, text: lines.join("\n") + "\n" }; // prettier-ignore
}

const padNumber = (index: number) => String(index).padStart(6, "0");
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
