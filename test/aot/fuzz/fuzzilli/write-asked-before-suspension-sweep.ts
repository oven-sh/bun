// A value is asked what it is, the function is suspended, and behind the suspension the answer is relied on: what is asked, times the question and the use, times the suspension, times what the caller does
// meanwhile, untyped and with written types. Each program holds one of each and is built alone.
//
//   bun write-asked-before-suspension-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<subject>--<question>--<use>--<suspension>--<deed>.<mjs|ts>
//   bun write-asked-before-suspension-sweep.ts count
//   bun write-asked-before-suspension-sweep.ts named <pattern> <folder> [most]
//
// Behind a `yield` or an `await` the code is entered anew: what stood in a register is gone, and any other code has run. A copy still is what it was asked to be. A field, an element or a variable outside may
// be anything by then.
import { mkdirSync, writeFileSync } from "fs";

// The statement that takes the subject, the expression that names it, and what the caller's deed changes.
const subjects: [string, string, string, "field" | "element" | "outside"][] = [
  ["a-copy-of-a-field", "const x = r.v;", "x", "field"],
  ["the-field-itself", "", "r.v", "field"],
  ["a-copy-of-an-element", "const x = r.list[0];", "x", "element"],
  ["the-element-itself", "", "r.list[0]", "element"],
  ["a-parameter", "", "given", "field"],
  ["a-variable-outside", "", "shared", "outside"],
];

// The question, the written type of the subject, and three uses.
const questions: [string, (x: string) => string, string, [string, (x: string) => string][]][] = [
  [
    "is-it-a-number",
    x => `typeof ${x} === "number"`,
    "number | string | null",
    [
      ["doubled", x => `${x} * 2`],
      ["as-an-integer", x => `${x} | 0`],
      ["beside-a-text", x => `"" + ${x}`],
    ],
  ],
  [
    "is-it-an-integer",
    x => `Number.isInteger(${x})`,
    "number",
    [
      ["plus-one", x => `${x} + 1`],
      ["its-remainder", x => `${x} % 3`],
      ["compared", x => `${x} < 3`],
    ],
  ],
  [
    "is-it-a-text",
    x => `typeof ${x} === "string"`,
    "string | number | null",
    [
      ["its-length", x => `${x}.length`],
      ["with-a-mark", x => `${x} + "!"`],
      ["its-first-code", x => `${x}.charCodeAt(0)`],
    ],
  ],
  [
    "is-it-a-record",
    x => `typeof ${x} === "object" && ${x} !== null`,
    "{ n: number } | string | null",
    [
      ["its-field", x => `${x}.n`],
      ["its-field-doubled", x => `${x}.n * 2`],
      ["its-keys", x => `Object.keys(${x}).join()`],
    ],
  ],
  [
    "is-it-a-list",
    x => `Array.isArray(${x})`,
    "number[] | string | null",
    [
      ["its-length", x => `${x}.length`],
      ["its-first", x => `${x}[0]`],
      ["joined", x => `${x}.join("+")`],
    ],
  ],
  [
    "is-it-a-box",
    x => `${x} instanceof Box`,
    "Box | string | null",
    [
      ["its-field", x => `${x}.n`],
      ["its-field-plus-one", x => `${x}.n + 1`],
      ["its-method", x => `${x}.twice()`],
    ],
  ],
  [
    "is-it-there",
    x => `${x} != null`,
    "number | null | undefined",
    [
      ["halved", x => `${x} / 2`],
      ["its-kind", x => `typeof ${x}`],
      ["negated", x => `-${x}`],
    ],
  ],
  [
    "is-it-small",
    x => `typeof ${x} === "number" && ${x} > 0 && ${x} < 8`,
    "number | string | null",
    [
      ["as-a-place-in-a-text", x => `"abcdefgh"[${x}]`],
      ["as-a-place-in-bytes", x => `bytes[${x}]`],
      ["squared", x => `${x} * ${x}`],
    ],
  ],
];

type Kind = "generator" | "async" | "async generator" | "plain";
// How the function is suspended and hands out `USE`.
const suspensions: [string, Kind, string][] = [
  ["no-suspension", "plain", "return USE;"],
  ["a-yield", "generator", "yield 0;\nyield USE;"],
  ["a-yield-whose-answer-is-kept", "generator", "const sent = yield 0;\nyield [sent, USE];"],
  ["a-yield-star", "generator", "yield* inner();\nyield USE;"],
  ["two-yields", "generator", "yield 0;\nyield 1;\nyield USE;"],
  ["a-yield-in-a-try", "generator", "try {\n  yield 0;\n} finally {\n  noted++;\n}\nyield USE;"],
  [
    "a-yield-in-a-loop",
    "generator",
    "let last;\nfor (let i = 0; i < 2; i++) {\n  yield i;\n  last = USE;\n}\nyield last;",
  ],
  ["an-await", "async", "await null;\nreturn USE;"],
  ["an-await-of-a-call", "async", "await later();\nreturn USE;"],
  [
    "an-await-in-a-loop",
    "async",
    "let last;\nfor (let i = 0; i < 2; i++) {\n  await null;\n  last = USE;\n}\nreturn last;",
  ],
  ["a-yield-of-an-async-generator", "async generator", "yield 0;\nyield USE;"],
  ["an-await-in-an-async-generator", "async generator", "yield 0;\nawait null;\nyield USE;"],
];

const deeds: [string, string | null][] = [
  ["nothing-is-done", ""],
  ["it-takes-a-text", `"zz"`],
  ["it-takes-a-fraction", "0.25"],
  ["it-takes-an-integer", "12"],
  ["it-takes-null", "null"],
  ["it-takes-a-record", "{ n: 8 }"],
  ["it-takes-a-list", "[6]"],
  ["it-goes-away", null],
];

const forms = ["mjs", "ts"] as const;
const usesOfEach = 3;
const all = subjects.length * questions.length * usesOfEach * suspensions.length * deeds.length * forms.length;

const indented = (text: string, by: string) =>
  text
    .split("\n")
    .map(line => by + line)
    .join("\n");

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [subject, take, x, target] = pick(subjects);
  const [deed, stored] = pick(deeds);
  const [suspension, kind, body] = pick(suspensions);
  const [question, test, written, uses] = pick(questions);
  const [use, used] = pick(uses);
  const form = pick(forms);
  const typed = form === "ts";

  const head = {
    generator: "function*",
    async: "async function",
    "async generator": "async function*",
    plain: "function",
  }[kind];
  const answers = {
    generator: ": Generator<unknown, void, unknown>",
    async: ": Promise<unknown>",
    "async generator": ": AsyncGenerator<unknown, void, unknown>",
    plain: ": unknown",
  }[kind];
  const place = { field: "first.v", element: "first.list[0]", outside: "shared" }[target];
  const gone = { field: "delete first.v;", element: "first.list.length = 0;", outside: "shared = undefined;" }[target];
  const done = stored === null ? gone : stored === "" ? "" : `${place} = ${stored};`;
  const cast = typed ? " as any" : "";
  const meanwhile =
    typed && done ? done.replace(/first/g, "(first as any)").replace(/^shared = (.*);$/, "shared = $1 as any;") : done;

  const steps = {
    plain: `steps.push(asked(first, first.v), asked(second, second.v));
    ${meanwhile}
    steps.push(asked(first, first.v));`,
    generator: `const a = asked(first, first.v), b = asked(second, second.v);
    steps.push(a.next().value, b.next().value);
    ${meanwhile}
    for (let turn = 0; turn < 3; turn++) steps.push(a.next(turn).value, b.next(turn).value);`,
    async: `const a = asked(first, first.v), b = asked(second, second.v);
    ${meanwhile}
    for (const settled of await Promise.allSettled([a, b]))
      steps.push(settled.status === "fulfilled" ? settled.value : "threw " + settled.reason.name);`,
    "async generator": `const a = asked(first, first.v), b = asked(second, second.v);
    steps.push((await a.next()).value, (await b.next()).value);
    ${meanwhile}
    for (let turn = 0; turn < 2; turn++) steps.push((await a.next()).value, (await b.next()).value);`,
  }[kind];

  const text = `class Box {
  n${typed ? ": number" : ""};
  constructor(n${typed ? ": number" : ""}) {
    this.n = n;
  }
  twice() {
    return this.n * 2;
  }
}
${typed ? `type Held = ${written};\ninterface Row {\n  v: Held;\n  list: Held[];\n}\n` : ""}let shared${typed ? ": Held = 0 as any" : ""};
let noted = 0;
const bytes = new Uint8Array([10, 11, 12, 13, 14, 15, 16, 17]);
function* inner() {
  yield 0;
}
async function later() {
  return 0;
}
const word = (value${typed ? ": unknown" : ""})${typed ? ": string" : ""} =>
  Object.is(value, -0) ? "-0" : typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
${head} asked(r${typed ? ": Row" : ""}, given${typed ? ": Held" : ""})${typed ? answers : ""} {
${take ? `  ${take}\n` : ""}  if (${test(x)}) {
${indented(body.replace(/USE/g, used(x)), "    ")}
  }${kind === "plain" || kind === "async" ? "\n  return undefined;" : ""}
}
const values = [...JSON.parse('[1,2.5,"a",-0,null,2147483648,7,{"n":3},[4],"",3,true]'), new Box(5), undefined, NaN];
const said${typed ? ": string[]" : ""} = [];
for (let at = 0; at < values.length; at++) {
  const next = values[(at + 1) % values.length];
  const first${typed ? ": Row" : ""} = { v: values[at], list: [values[at]] };
  const second${typed ? ": Row" : ""} = { v: next, list: [next] };
  shared = first.v;
  const steps${typed ? ": unknown[]" : ""} = [];
  try {
    ${steps}
  } catch (error) {
    steps.push("threw " + (error${cast}).name);
  }
  said.push(steps.map(word).join(","));
}
console.log(said.join(" | "));
console.log(noted, word(shared));
export {};
`;
  return {
    name: `${subject}--${question}--${use}--${suspension}--${deed}.${form}`,
    text: text.replace(/\n    \n/g, "\n"),
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let written = 0;
  for (let at = 0; at < all && written < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    written++;
  }
  console.log(written);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
