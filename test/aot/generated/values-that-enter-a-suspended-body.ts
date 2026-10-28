// A value enters a suspended body: what next(), throw() and return() hand in, what an awaited promise is fulfilled or rejected with, what a thenable's `then` throws, what an inner
// iterator answers. The suspension (yield, await, yield*, in a generator, an async generator or an async function) stands alone or inside try, catch and finally, nested, in a loop or not,
// beside a return, a throw, a break or a continue. The body uses the value in a form that hangs on its kind: as a condition, in a sum, under typeof, by a member, in a comparison.
// Every coroutine has its own calls, so what is known about the values it is handed is as narrow as the program allows.
//
//   bun values-that-enter-a-suspended-body.ts <folder> [few]    writes the programs there; `few`: one program for all the places of a suspension
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

type Kind = "generator" | "async generator" | "async function";

const operands = [
  { name: "a number", text: "7" },
  { name: "a fulfilled promise", text: "Promise.resolve(7)" },
  { name: "a rejection with an error", text: 'Promise.reject(new Error("broken"))' },
  { name: "a rejection with a number", text: "Promise.reject(1.5)" },
  { name: "a then that throws", text: '{ then() { throw new Error("then throws"); } }' },
  { name: "a then that rejects", text: '{ then(fulfill, reject) { reject(new Error("then rejects")); } }' },
  { name: "a then that fulfills", text: "{ then(fulfill) { fulfill({ a: 3 }); } }" },
];

type Suspension = {
  name: string;
  kinds: Kind[];
  before?: (id: string, operand: string, kind: Kind) => string;
  text: (id: string, operand: string) => string;
};
const suspensions: Suspension[] = [
  { name: "yield", kinds: ["generator", "async generator"], text: (_, operand) => `(yield ${operand})` },
  { name: "await", kinds: ["async generator", "async function"], text: (_, operand) => `(await ${operand})` },
  { name: "yield await", kinds: ["async generator"], text: (_, operand) => `(yield await ${operand})` },
  {
    name: "yield of what a yield answers",
    kinds: ["generator", "async generator"],
    text: (_, operand) => `(yield yield ${operand})`,
  },
  {
    name: "yield-star of a list",
    kinds: ["generator", "async generator"],
    text: (_, operand) => `(yield* [${operand}])`,
  },
  {
    name: "yield-star of a coroutine",
    kinds: ["generator", "async generator"],
    before: (id, operand, kind) =>
      `${kind === "generator" ? "" : "async "}function* inner${id}() { return yield ${operand}; }`,
    text: id => `(yield* inner${id}())`,
  },
];

const uses = [
  { name: "condition", text: (s: string, id: string, exit: string) => `if (${s}) { ${exit} }` },
  { name: "sum", text: (s: string, id: string, exit: string) => `total += ${s}; if (flag) { ${exit} }` },
  {
    name: "typeof",
    text: (s: string, id: string, exit: string) => `const got = ${s}; out("${id}", typeof got); if (flag) { ${exit} }`,
  },
  {
    name: "member",
    text: (s: string, id: string, exit: string) => `out("${id}", show(${s}?.a)); if (flag) { ${exit} }`,
  },
  { name: "unused", text: (s: string, id: string, exit: string) => `${s}; if (flag) { ${exit} }` },
  {
    name: "comparison",
    text: (s: string, id: string, exit: string) => `out("${id}", ${s} === undefined); if (flag) { ${exit} }`,
  },
];
const sent = [
  { name: "nothing", text: "" },
  { name: "an integer", text: "1" },
  { name: "a fraction", text: "1.5" },
  { name: "a boolean", text: "true" },
  { name: "a text", text: '"text"' },
  { name: "an object", text: "{ a: 1 }" },
];
const usesOfSentValues: [string, string][] = [
  ["condition", "nothing"],
  ["condition", "an integer"],
  ["condition", "a boolean"],
  ["condition", "an object"],
  ["sum", "an integer"],
  ["sum", "a fraction"],
  ["sum", "a text"],
  ["typeof", "an object"],
  ["member", "an object"],
  ["unused", "an integer"],
  ["comparison", "an integer"],
];

const caught = (id: string) =>
  `out("${id}", "caught", typeof error, error instanceof Error, error === undefined, show(error));`;
type Place = { name: string; text: (body: string, id: string, again: string) => string };
const places: Place[] = [
  { name: "alone", text: body => body },
  { name: "try finally", text: (body, id) => `try { ${body} } finally { out("${id}", "finally"); }` },
  { name: "try and an empty finally", text: body => `try { ${body} } finally { }` },
  { name: "try catch", text: (body, id) => `try { ${body} } catch (error) { ${caught(id)} }` },
  {
    name: "try catch finally",
    text: (body, id) => `try { ${body} } catch (error) { ${caught(id)} } finally { out("${id}", "finally"); }`,
  },
  {
    name: "two finallys",
    text: (body, id) => `try { try { ${body} } finally { out("${id}", "inner"); } } finally { out("${id}", "outer"); }`,
  },
  {
    name: "a catch that throws on, in a finally",
    text: (body, id) =>
      `try { try { ${body} } catch (error) { ${caught(id)} throw error; } } finally { out("${id}", "finally"); }`,
  },
  {
    name: "a finally in a catch",
    text: (body, id) => `try { try { ${body} } finally { out("${id}", "inner"); } } catch (error) { ${caught(id)} }`,
  },
  {
    name: "a finally that suspends",
    text: (body, id, again) => `try { ${body} } finally { out("${id}", "finally", show(${again})); }`,
  },
  {
    name: "a catch that suspends",
    text: (body, id, again) =>
      `try { ${body} } catch (error) { ${caught(id)} out("${id}", "then", show(${again})); } finally { }`,
  },
];
const surroundings = [
  {
    name: "",
    exits: ['out("none");', 'return "early";', 'throw new Error("own");', "break block;"],
    text: (inner: string) => `block: { ${inner} }`,
  },
  {
    name: " in a loop",
    exits: ["break;", "continue;", 'return "early";'],
    text: (inner: string) => `for (let turn = 0; turn < 2; turn++) { ${inner} }`,
  },
];

type Driver = { name: string; kinds: Kind[]; text: (id: string, value: string, wait: string) => string };
const call = (id: string, label: string, text: string, wait: string) =>
  `try { const step = ${wait}${text}; out("${id}", "${label}", show(step.value), step.done); } catch (error) { out("${id}", "${label} threw", show(error)); }`;
const both: Kind[] = ["generator", "async generator"];
const drivers: Driver[] = [
  {
    name: "next",
    kinds: both,
    text: (id, v, w) => [1, 2, 3].map(() => call(id, "next", `walk.next(${v})`, w)).join("\n  "),
  },
  {
    name: "throw",
    kinds: both,
    text: (id, v, w) =>
      [
        call(id, "next", `walk.next(${v})`, w),
        call(id, "throw", `walk.throw(new Error("thrown in"))`, w),
        call(id, "next", `walk.next(${v})`, w),
      ].join("\n  "),
  },
  {
    name: "return",
    kinds: both,
    text: (id, v, w) =>
      [
        call(id, "next", `walk.next(${v})`, w),
        call(id, "return", `walk.return("given")`, w),
        call(id, "next", `walk.next(${v})`, w),
      ].join("\n  "),
  },
  {
    name: "return of a rejection",
    kinds: ["async generator"],
    text: (id, v, w) =>
      [
        call(id, "next", `walk.next(${v})`, w),
        call(id, "return", `walk.return(Promise.reject(new Error("rejected return")))`, w),
        call(id, "next", `walk.next(${v})`, w),
      ].join("\n  "),
  },
  {
    name: "return of a fulfilled promise",
    kinds: ["async generator"],
    text: (id, v, w) =>
      [
        call(id, "next", `walk.next(${v})`, w),
        call(id, "return", `walk.return(Promise.resolve({ a: 2 }))`, w),
        call(id, "next", `walk.next(${v})`, w),
      ].join("\n  "),
  },
  {
    name: "return of a then that throws",
    kinds: ["async generator"],
    text: (id, v, w) =>
      [
        call(id, "next", `walk.next(${v})`, w),
        call(id, "return", `walk.return({ then() { throw new Error("then of return throws"); } })`, w),
        call(id, "next", `walk.next(${v})`, w),
      ].join("\n  "),
  },
  {
    name: "a loop",
    kinds: both,
    text: (id, _, w) =>
      `try { for ${w}(const value of walk) out("${id}", "value", show(value)); } catch (error) { out("${id}", "loop threw", show(error)); }`,
  },
  {
    name: "calls that do not wait",
    kinds: ["async generator"],
    text: (id, v) =>
      `for (const one of await Promise.allSettled([walk.next(${v}), walk.next(${v}), walk.return("given"), walk.next(${v})])) out("${id}", one.status, show(one.status === "fulfilled" ? one.value : one.reason));`,
  },
  {
    name: "a call",
    kinds: ["async function"],
    text: id =>
      `try { out("${id}", "answer", show(await walk)); } catch (error) { out("${id}", "threw", show(error)); }`,
  },
];

const prelude = `const lines = [];
const out = (...parts) => lines.push(parts.join(" "));
const no = process.argv.length > 9;
function show(value) {
  if (value instanceof Promise) {
    value.catch(() => {});
    return "a promise";
  }
  if (value instanceof Error) return "Error(" + value.message + ")";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return typeof value + ":" + String(value);
}
`;

const heads: Record<Kind, string> = {
  "generator": "function*",
  "async generator": "async function*",
  "async function": "async function",
};

type Surrounding = (typeof surroundings)[number];
type Title = { kind: Kind; suspension: Suspension; use: (typeof uses)[number]; value: string; driver: Driver };

function textOf(
  { kind, suspension, use, value, driver }: Title,
  where: [Place, Surrounding][],
  firstNumber: number,
): string {
  const wait = kind === "generator" ? "" : "await ";
  const again = kind === "async function" ? '(await "again")' : '(yield "again")';
  const texts: string[] = [];
  let number = firstNumber;
  for (const [place, around] of where)
    for (const exit of around.exits)
      for (const operand of operandsOf(kind)) {
        const id = `c${number++}`;
        const body = use.text(suspension.text(id, operand.text), id, exit.replace('"none"', `"${id}", "no exit"`));
        texts.push(
          `// ${place.name}${around.name}, ${exit} ${operand.name}`,
          ...(suspension.before ? [suspension.before(id, operand.text, kind)] : []),
          `${heads[kind]} made${id}(flag) {\n  let total = 0;\n  ${around.text(place.text(body, id, again))}\n  out("${id}", "end", total);\n  return total;\n}`,
          ...["no", "!no"].map(flag => `{\n  const walk = made${id}(${flag});\n  ${driver.text(id, value, wait)}\n}`),
        );
      }
  return `${prelude}${texts.join("\n")}\nconsole.log(lines.join("\\n"));\n`;
}

// A generator hands on what it yields as it is.
const operandsOf = (kind: Kind) =>
  kind === "generator"
    ? operands.filter(operand => /^a (number|rejection with an error|then that throws)$/.test(operand.name))
    : operands;

export function programs(few = false): { name: string; file: string; text: () => string }[] {
  const written: { name: string; file: string; text: () => string }[] = [];
  const everywhere = places.flatMap(place => surroundings.map((around): [Place, Surrounding] => [place, around]));
  for (const kind of Object.keys(heads) as Kind[])
    for (const suspension of suspensions.filter(s => s.kinds.includes(kind)))
      for (const [useName, sentName] of kind === "async function"
        ? uses.map(use => [use.name, "nothing"])
        : usesOfSentValues)
        for (const driver of drivers.filter(d => d.kinds.includes(kind))) {
          const title: Title = {
            kind,
            suspension,
            use: uses.find(u => u.name === useName)!,
            value: sent.find(s => s.name === sentName)!.text,
            driver,
          };
          const name = `${kind}, ${suspension.name}, ${useName} of ${sentName}, driven by ${driver.name}`;
          if (few) {
            written.push({ name, file: "main.mjs", text: () => textOf(title, everywhere, 0) });
            continue;
          }
          let number = 0;
          for (const one of everywhere) {
            const firstNumber = number;
            number += one[1].exits.length * operandsOf(kind).length;
            written.push({
              name: `${name}, ${one[0].name}${one[1].name}`,
              file: "main.mjs",
              text: () => textOf(title, [one], firstNumber),
            });
          }
        }
  return written;
}

if (import.meta.main) {
  const folder = process.argv[2];
  mkdirSync(folder, { recursive: true });
  for (const { name, text } of programs(process.argv[3] === "few"))
    writeFileSync(join(folder, name.replace(/[^\w-]+/g, "_") + ".mjs"), text());
}
