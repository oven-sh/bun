// A choice among values: what is chosen by, times how the choice is written, times what its arms do, times how many there are. Every program asks every case, values beside the cases and values of other kinds, in a loop and once.
//
//   bun write-choice-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<subject>--<form>--<arms>--<cases>.mjs or .ts
//   bun write-choice-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

// The n-th case, values that are no case, and the lines of the file that they need.
const subjects: [name: string, of: (n: number) => string, others: string[], before: string][] = [
  [
    "texts",
    n => `"${"abcdefghijklmnopqrstuvwxyz"[n % 26]}${n >= 26 ? n : ""}"`,
    ['""', '"A"', '"aa"', "undefined", "97"],
    "",
  ],
  ["long-texts", n => `"a-longer-name-${n}"`, ['"a-longer-name-"', '"a-longer-name-x"', "null"], ""],
  ["one-length", n => `"k${String(n).padStart(3, "0")}"`, ['"k999"', '"K000"', '"k00"'], ""],
  ["prefixes", n => `"${"x".repeat(n + 1)}"`, ['""', '"xxy"', '"y"'], ""],
  ["joined-texts", n => `"t${n}"`, ['"t"', '"t" + 99', "0"], ""],
  ["small-ints", n => String(n), ["-1", "0.5", '"1"', "-0", "NaN", "true"], ""],
  ["ints-from-1000", n => String(1000 + n), ["999", "1000.5", "2147483647", "-1000"], ""],
  ["sparse-ints", n => String((n * n * 7919) % 100003), ["1", "-1", "2147483648", "0.25"], ""],
  ["negative-ints", n => String(-n - 1), ["0", "1", "-0.5"], ""],
  ["powers", n => String(2 ** (n % 31)), ["3", "0", "4294967296", "-2147483648"], ""],
  ["doubles", n => String(n + 0.5), ["0", "1", "NaN", "0.25"], ""],
  ["character-codes", n => String(97 + (n % 26) + (n >= 26 ? 100 : 0)), ["32", "65", "NaN", "96.5"], ""],
  ["types", n => ['"number"', '"string"', '"boolean"', '"undefined"', '"object"', '"function"', '"symbol"', '"bigint"'][n % 8], ['"Number"', '""'], ""], // prettier-ignore
  ["kinds", n => ["null", "undefined", "true", "false", "0", '""', "NaN", "1n"][n % 8], ["-0", "0n", '"0"'], ""],
  ["objects", n => `things[${n}]`, ["{}", "null", "0"], "const things = Array.from({ length: 64 }, (_, at) => ({ at }));"], // prettier-ignore
  ["classes", n => `kinds[${n % 6}]`, ["Object", "null"], "class A {}\nclass B {}\nclass C extends A {}\nconst kinds = [A, B, C, Array, Map, String];"], // prettier-ignore
  ["symbols", n => `signs[${n % 8}]`, ['Symbol("s0")', '"s0"'], 'const signs = Array.from({ length: 8 }, (_, at) => Symbol("s" + at));'], // prettier-ignore
  ["mixed", n => [`${n}`, `"${n}"`, `${n}.5`, "null", "true"][n % 5], ["undefined", '"x"', "-1", "false"], ""],
];
const forms = ["ifs", "early-returns", "switch", "switch-returns", "switch-through", "switch-default-first", "switch-default-between", "conditional", "table", "map", "either", "denied", "switch-true", "includes"] as const; // prettier-ignore
// `#` is the number of the arm.
const arms: [name: string, text: string, value: string][] = [
  ["values", "r = #;", "#"],
  ["texts", 'r = "arm#";', '"arm#"'],
  ["pairs", "r = # >> 1;", "# >> 1"],
  ["alike", "r = 7;", "7"],
  ["stores", "state.last = #;\nr = state.last;", "(state.last = #)"],
  ["counts", "state.count++;\nr = state.count;", "++state.count"],
  ["calls", "r = act(#);", "act(#)"],
  ["pushes", "state.log.push(#);\nr = state.log.length;", "state.log.push(#)"],
];
const counts = [2, 3, 5, 9, 20, 40];
const total = subjects.length * forms.length * arms.length * counts.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const subject = pick(subjects);
  const form = pick(forms);
  const arm = pick(arms);
  const count = pick(counts);
  const isTyped = cell % 4 === 2;
  const any = isTyped ? ": any" : "";
  // Half of the typed programs whose cases are literals hand over what the types say and nothing else.
  const isUnion = cell % 8 === 6 && !subject[3] && subject[0] !== "kinds" && subject[0] !== "joined-texts";
  const seen = new Set<string>();
  const cases = Array.from({ length: count }, (_, n) => subject[1](n)).filter(one => !seen.has(one) && seen.add(one)); // prettier-ignore
  const done = (n: number) => arm[1].replaceAll("#", String(n)).split("\n");
  const value = (n: number) => arm[2].replaceAll("#", String(n));
  const indent = (lines: string[]) => lines.map(line => "  " + line);
  const other = ["r = -1;"];
  const label = (one: string, n: number, ends: string) => [`  case ${one}:`, ...indent(indent([...done(n), ...(ends ? [ends] : [])]))]; // prettier-ignore
  const choose = (): string[] => {
    if (form === "early-returns") return cases.flatMap((one, n) => [`if (x === ${one}) {`, ...indent([...done(n), "return r;"]), "}"]).concat(other); // prettier-ignore
    if (form === "switch") return ["switch (x) {", ...cases.flatMap((one, n) => label(one, n, "break;")), "  default:", ...indent(indent(other)), "}"]; // prettier-ignore
    if (form === "switch-returns") return ["switch (x) {", ...cases.flatMap((one, n) => label(one, n, "return r;")), "}", ...other]; // prettier-ignore
    if (form === "switch-through") return ["switch (x) {", ...cases.flatMap((one, n) => (n % 3 === 1 ? [`  case ${one}:`] : label(one, n, n % 4 === 2 ? "" : "break;"))), "  default:", "    state.count += 100;", "}"]; // prettier-ignore
    if (form === "switch-default-first") return ["switch (x) {", "  default:", ...indent(indent([...other, "break;"])), ...cases.flatMap((one, n) => label(one, n, "break;")), "}"]; // prettier-ignore
    if (form === "switch-default-between") return ["switch (x) {", ...cases.slice(0, 1).flatMap((one, n) => label(one, n, "break;")), "  default:", "    state.count += 10;", ...cases.slice(1).flatMap((one, n) => label(one, n + 1, n % 2 ? "break;" : "")), "}"]; // prettier-ignore
    if (form === "conditional") return [`r = ${cases.map((one, n) => `x === ${one} ? ${value(n)} : `).join("")}-1;`];
    if (form === "table") return [`const table${any} = { ${cases.map((one, n) => `[String(${one === "1n" ? '"1n"' : one.startsWith("signs") ? one + ".description" : one})]: ${n}`).join(", ")} };`, `r = act(table[String(${isUnion ? "x" : 'typeof x === "symbol" ? x.description : x'})] ?? -1);`]; // prettier-ignore
    if (form === "map") return [`const table${isTyped ? ": Map<any, any>" : ""} = new Map${isTyped ? "<any, any>" : ""}([${cases.map((one, n) => `[${one}, ${n}]`).join(", ")}]);`, "r = act(table.get(x) ?? -1);"]; // prettier-ignore
    if (form === "either") return [`if (${cases.map(one => `x === ${one}`).join(" || ")}) {`, ...indent(done(3)), "} else {", ...indent(other), "}"]; // prettier-ignore
    if (form === "denied") return [`if (${cases.map(one => `x !== ${one}`).join(" && ")}) {`, ...indent(other), "} else {", ...indent(done(5)), "}"]; // prettier-ignore
    if (form === "switch-true") return ["switch (true) {", ...cases.flatMap((one, n) => label(`x === ${one}`, n, "break;")), "  default:", ...indent(indent(other)), "}"]; // prettier-ignore
    if (form === "includes") return [`if ([${cases.join(", ")}].includes(x)) {`, ...indent(done(4)), "} else {", ...indent(other), "}"]; // prettier-ignore
    return cases.flatMap((one, n) => [(n ? "} else " : "") + `if (x === ${one}) {`, ...indent(done(n))]).concat(["} else {", ...indent(other), "}"]); // prettier-ignore
  };
  const asked = [...cases, ...(isUnion ? [] : subject[2])].map(one => (subject[0] === "joined-texts" && one.startsWith('"t') && /^"t\d+"$/.test(one) ? `"t" + ${one.slice(2, -1)}` : one)); // prettier-ignore
  const isParsed = cell % 3 === 0 && asked.every(one => /^(-?\d+(\.\d+)?|"[^"\\]*"|true|false|null)$/.test(one) && one !== "-0"); // prettier-ignore
  const lines = [
    ...(subject[3] ? subject[3].split("\n").map(line => (isTyped ? line.replace(/^const (things|kinds|signs) =/, "const $1: any[] =") : line)) : []), // prettier-ignore
    `const state${any} = { last: 0, count: 0, log: [] };`,
    `function act(n${any})${any} {\n  state.last = n;\n  return "acted " + n;\n}`,
    ...(isUnion ? [`type Choice = ${cases.join(" | ")};`] : []),
    `function choose(x${isUnion ? ": Choice" : any})${any} {`,
    `  let r${any} = 0;`,
    ...indent(choose()),
    "  return r;",
    "}",
    `const asked${isUnion ? ": Choice[]" : isTyped ? ": any[]" : ""} = ${isParsed ? `JSON.parse(${JSON.stringify(`[${asked.join(", ")}]`)})` : `[${asked.join(", ")}]`};`,
    `const told${isTyped ? ": any[]" : ""} = [];`,
    "for (let turn = 0; turn < 2; turn++) for (const one of asked) told.push(choose(one));",
    "console.log(told.map(String).join());",
    ...asked.slice(0, 3).map(one => `console.log(String(choose(${one})), state.last, state.count, state.log.length);`),
    ...(isTyped ? ["export {};"] : []),
  ];
  return {
    name: `${subject[0]}--${form}--${arm[0]}--${count}${isTyped ? ".ts" : ".mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(5, "0");
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
