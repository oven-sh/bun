// Guards in a row: what is asked, times how the bounds are compared, times what each guard does before it leaves, times how it leaves, times how the guards are written, times how many there are.
// Two guards that leave alike and do something of their own must not become one test.
//
//   bun write-guards-in-a-row-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<asked>--<comparisons>--<done>--<left>--<form>--<guards>.mjs or .ts
//   bun write-guards-in-a-row-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// `x` is what the guards compare; `given` is the parameter.
const askedOf: [name: string, before: string, values: string][] = [
  ["whole", "const x = given | 0;", "[1, 9, 5, 3, 7, 2, 8, -4, 100]"],
  ["given", "const x = given;", "[1, 9, 5, 3, 7, 2.5, 8, -4, 100]"],
  ["parsed", "const x = given;", 'JSON.parse("[1, 9, 5, 3, 7, 2, 8, -4, 100]")'],
  ["length-of-a-text", "const x = given.length;", '["ab", "much too long", "right", "", "1234567", "12345678", "abc"]'],
  [
    "length-of-a-list",
    "const x = given.length;",
    "[[], [1, 2, 3], new Array(9), [1], [1, 2, 3, 4, 5, 6, 7], new Array(8)]",
  ],
  ["field", "const x = given.size;", "[{ size: 1 }, { size: 9 }, { size: 5 }, { size: 3 }, { size: 7 }, { size: 8 }]"],
  ["reassigned", "let x = given;\nx = x | 0;", "[1, 9, 5, 3, 7, 2, 8, -4, 100]"],
  ["unsigned", "const x = given >>> 0;", "[1, 9, 5, 3, 7, 2, 8, -4, 100]"],
  ["element", "const x = given[0];", "[[1], [9], [5], [], [7.5], [3], [8], [undefined]]"],
  ["character", "const x = given.charCodeAt(0) - 48;", '["1", "9", "5", "", "7", "3", "8", "a"]'],
];
const comparisons: [name: string, tests: string[]][] = [
  ["outside", ["x < 3", "x > 7", "x === 5", "x === 4"]],
  ["outside-with-ends", ["x <= 2", "x >= 8", "x === 5", "x === 4"]],
  ["above-first", ["x > 7", "x < 3", "x === 5", "x === 6"]],
  ["turned", ["3 > x", "7 < x", "5 === x", "4 === x"]],
  ["steps", ["x < 2", "x < 4", "x < 6", "x < 8"]],
  ["steps-down", ["x > 8", "x > 6", "x > 4", "x > 2"]],
  ["single-values", ["x === 1", "x === 9", "x === 5", "x === 3"]],
  ["neighbors", ["x === 7", "x === 8", "x === 9", "x === 3"]],
  ["denied", ["!(x >= 3)", "!(x <= 7)", "!(x !== 5)", "!(x !== 4)"]],
  ["both-bounds", ["x < 3 || x === 4", "x > 7 && x < 50", "x >= 50", "x === 5"]],
];
// `#` is the number of the guard.
const doings: [name: string, text: string][] = [
  ["stores", "state# = 1;"],
  ["stores-one", "reason = #;"],
  ["stores-a-field", "o.reason = #;"],
  ["stores-own-field", "o.state# = 1;"],
  ["counts", "state#++;"],
  ["calls", "call#();"],
  ["calls-one", "call(#);"],
  ["calls-a-method", "o.method#();"],
  ["calls-a-given", "given#();"],
  ["pushes", "log.push(#);"],
  ["writes-text", 'text += "#";'],
  ["stores-an-element", "log[#] = 1;"],
  ["keeps-text", 'reason = "guard #";'],
  ["keeps-a-constant", "reason = Reason.r#;"],
  ["nothing-first", "if (# > 1) reason = #;"],
  ["two", "state# = 1;\nreason = #;"],
];
const leavings: [name: string, text: string, isInLoop: boolean][] = [
  ["false", "return false;", false],
  ["zero", "return 0;", false],
  ["nothing", "return;", false],
  ["own", "return #;", false],
  ["what-is-asked", "return x;", false],
  ["throw", 'throw new Error("left");', false],
  ["continue", "continue;", true],
  ["break", "break;", true],
];
const forms = ["ifs", "else-ifs", "tests-first", "tests-between", "conditional", "switch", "block"] as const;
const counts = [2, 3, 4];
const total = askedOf.length * comparisons.length * doings.length * leavings.length * forms.length * counts.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const asked = pick(askedOf);
  const comparison = pick(comparisons);
  const doing = pick(doings);
  const leaving = pick(leavings);
  const form = pick(forms);
  const count = pick(counts);
  const isTyped = cell % 5 === 2;
  const any = isTyped ? ": any" : "";
  const binding = cell % 3 === 1 ? "var" : "let";
  const numbers = Array.from({ length: count }, (_, at) => at + 1);
  const steps = (at: number) => (doing[1] + "\n" + leaving[1]).replaceAll("#", String(at)).split("\n");
  const test = (at: number) => comparison[1][at - 1];
  const indent = (lines: string[]) => lines.map(line => "  " + line);
  const guards = (): string[] => {
    if (form === "tests-first") return [...numbers.map(at => `const is${at} = ${test(at)};`), ...numbers.flatMap(at => [`if (is${at}) {`, ...indent(steps(at)), "}"])]; // prettier-ignore
    if (form === "tests-between") return numbers.flatMap(at => [`const is${at} = ${test(at)};`, `if (is${at}) {`, ...indent(steps(at)), "}"]); // prettier-ignore
    if (form === "else-ifs") return numbers.flatMap(at => [(at > 1 ? "} else " : "") + `if (${test(at)}) {`, ...indent(steps(at))]).concat("}"); // prettier-ignore
    if (form === "switch" && !leaving[2]) return ["switch (true) {", ...numbers.flatMap(at => [`  case ${test(at)}:`, ...indent(indent(steps(at)))]), "}"]; // prettier-ignore
    if (form === "conditional") return [`const which = ${numbers.map(at => `${test(at)} ? ${at} : `).join("")}0;`, ...numbers.flatMap(at => [`if (which === ${at}) {`, ...indent(steps(at)), "}"])]; // prettier-ignore
    if (form === "block") return numbers.flatMap(at => ["{", `  if (${test(at)}) {`, ...indent(indent(steps(at))), "  }", "}"]); // prettier-ignore
    return numbers.flatMap(at => [`if (${test(at)}) {`, ...indent(steps(at)), "}"]);
  };
  const before = asked[1].replace(/^(const|let) x/, isTyped && asked[0] !== "length-of-a-text" ? "$1 x: any" : "$1 x").split("\n"); // prettier-ignore
  const parameters = [`given${any}`, ...numbers.map(at => `given${at}${any} = call${at}`)].join(", ");
  const body = leaving[2]
    ? [
        ...before.slice(0, 0),
        "let turns = 0;",
        "for (let i = 0; i < 3; i++) {",
        ...indent([...before, "turns++;", ...guards(), "passed++;"]),
        "}",
        "return turns;",
      ]
    : [...before, ...guards(), "passed++;", "return true;"];
  const state = ["passed", ...numbers.map(at => "state" + at)];
  const lines = [
    ...state.map(name => `${binding} ${name} = 0;`),
    `${binding} reason${any} = 0;`,
    `${binding} text = "";`,
    `${binding} log${any} = [];`,
    isTyped
      ? `enum Reason {\n  none,\n${numbers.map(at => `  r${at},`).join("\n")}\n}`
      : `const Reason = { ${numbers.map(at => `r${at}: "r${at}"`).join(", ")} };`,
    `const o${any} = { reason: 0, ${numbers.map(at => `state${at}: 0, method${at}() {\n  state${at} = 1;\n}`).join(", ")} };`, // prettier-ignore
    ...numbers.map(at => `function call${at}()${isTyped ? ": void" : ""} {\n  text += "c${at}";\n  state${at} = 1;\n}`),
    `function call(which${isTyped ? ": number" : ""})${isTyped ? ": void" : ""} {\n  if (which === 1) state1 = 1;\n  else state2 = which;\n}`, // prettier-ignore
    `function check(${parameters})${any} {`,
    ...indent(body),
    "}",
    `for (const value of ${asked[2]}${isTyped ? " as any[]" : ""}) {`,
    `  ${[...state, "reason", "o.reason", ...numbers.map(at => "o.state" + at)].map(name => `${name} = 0;`).join(" ")} text = ""; log = [];`,
    "  let result" + any + ";",
    "  try {",
    "    result = check(value);",
    "  } catch (error) {",
    `    result = ${isTyped ? "(error as any)" : "error"}?.name;`,
    "  }",
    `  console.log(String(result), ${[...state, "reason", "o.reason", ...numbers.map(at => "o.state" + at)].join(", ")}, text, log.join("+"));`, // prettier-ignore
    "}",
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${asked[0]}--${comparison[0]}--${doing[0]}--${leaving[0]}--${form}--${count}${isTyped ? ".ts" : ".mjs"}`,
    text: lines.join("\n") + "\n",
  };
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
