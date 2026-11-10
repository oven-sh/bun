// A member is reached under a key in brackets that is known when the program is built, and the key stands under a cast: what holds the member, times how the key is written, times the cast, times what is done
// under the key. Each program holds one of each and as good as nothing else, and is built alone.
//
//   bun write-cast-key-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<holder>--<key>--<cast>--<use>.ts
//   bun write-cast-key-sweep.ts count
//   bun write-cast-key-sweep.ts named <pattern> <folder> [most]
//
// A cast changes nothing in what a program does. Whoever reads a program more than once, to see which parts of a library it enters and again to compile it, has to see through a cast both times or neither.
// Where one reading takes `Math["abs" as "abs"]` for `Math.abs` and the other for a key that nobody knows, they part on what the program needs. A program that uses much of the library anyway hides that, so
// these print one expression and declare only what the expression names. Some are refused by the type check, which is an answer too.
import { mkdirSync, writeFileSync } from "fs";

// What holds the member, what it needs declared, the member's name, and the arguments of a call.
const holders: [string, string, string, string, string][] = [
  ["math", "Math", "", "abs", "(-1)"],
  ["math-with-two-arguments", "Math", "", "max", "(1, 2)"],
  ["json", "JSON", "", "stringify", "([1])"],
  ["object", "Object", "", "keys", "({ a: 1 })"],
  ["array", "Array", "", "isArray", "([])"],
  ["number", "Number", "", "isInteger", "(1)"],
  ["string", "String", "", "fromCharCode", "(65)"],
  ["reflect", "Reflect", "", "ownKeys", "({ a: 1 })"],
  ["date", "Date", "", "UTC", "(2000, 0)"],
  ["the-global-object", "globalThis", "", "parseInt", '("7")'],
  ["a-text", '"text"', "", "toUpperCase", "()"],
  ["a-list", "[3, 1, 2]", "", "slice", "(1)"],
  ["a-number", "(5)", "", "toFixed", "(1)"],
  ["a-map", "new Map([[1, 2]])", "", "get", "(1)"],
  ["a-record", "handlers", 'const handlers = { info: () => "i", warn: () => "w" };', "warn", "()"],
  [
    "a-record-with-a-method",
    "counter",
    "const counter = { step: 2, twice() { return this.step * 2; } };",
    "twice",
    "()",
  ],
  ["a-class", "Tally", "class Tally { static count() { return 3; } }", "count", "()"],
  ["an-instance", "new Tally()", "class Tally { count() { return 3; } }", "count", "()"],
  ["a-function", "made", "function made() { return 1; }", "call", "(null)"],
  ["a-frozen-record", "fixed", "const fixed = Object.freeze({ pick: () => 4 });", "pick", "()"],
];

// How the key is written, and what that needs declared. NAME is the member's name.
const keys: [string, string, string][] = [
  ["written", '"NAME"', ""],
  ["a-template", "`NAME`", ""],
  ["in-parentheses", '("NAME")', ""],
  ["a-constant", "key", 'const key = "NAME";'],
  ["a-constant-written-as-one", "key", 'const key = "NAME" as const;'],
  ["two-halves", '("HEAD" + "TAIL")', ""],
  ["a-member-of-an-enum", "Key.It", 'enum Key { It = "NAME" }'],
  ["a-field-of-a-constant-record", "names.it", 'const names = { it: "NAME" } as const;'],
];

// The cast around KEY, what it needs declared, and whether the holder has to be cast away for the type check to take it.
const casts: [string, string, string, boolean][] = [
  ["no-cast", "KEY", "", false],
  ["as-its-own-text", 'KEY as "NAME"', "", false],
  ["as-const", "KEY as const", "", false],
  ["as-a-key-of-the-holder", "KEY as keyof typeof held", "", false],
  ["as-a-name-for-its-text", "KEY as Name", 'type Name = "NAME";', false],
  ["as-a-union-that-holds-it", "KEY as Level", 'type Level = "NAME" | "other";', true],
  ["as-a-text", "KEY as string", "", true],
  ["as-a-name-for-text", "KEY as Text", "type Text = string;", true],
  ["as-any", "KEY as any", "", false],
  ["as-unknown-and-then-a-number", "KEY as unknown as number", "", true],
  ["twice", 'KEY as "NAME" as "NAME"', "", false],
  ["in-angle-brackets", '<"NAME">KEY', "", false],
  ["not-null", "KEY!", "", false],
  ["satisfies", 'KEY satisfies "NAME"', "", false],
];

// HELD is the holder, K the key under its cast, ARGS the arguments.
const uses: [string, string][] = [
  ["called", "HELD[K]ARGS"],
  ["asked-for-its-kind", "typeof HELD[K]"],
  ["called-if-it-is-there", "HELD?.[K]?.ARGS"],
  ["asked-whether-it-is-in", "K in Object(HELD)"],
  ["read-by-reflection", "typeof Reflect.get(Object(HELD), K)"],
  ["taken-out-by-a-pattern", "(({ [K]: got }) => typeof got)(HELD)"],
  ["a-key-of-a-literal", "Object.keys({ [K]: 1 })"],
  ["a-name-of-a-static-method", "class { static [K]() { return 1; } }[K]()"],
];

const all = holders.length * keys.length * casts.length * uses.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [cast, around, forCast, away] = pick(casts);
  const [key, spelled, forKey] = pick(keys);
  const [use, shape] = pick(uses);
  const [holder, held, forHolder, member, args] = pick(holders);
  const named = (text: string) =>
    text.replaceAll("NAME", member).replaceAll("HEAD", member.slice(0, 1)).replaceAll("TAIL", member.slice(1));
  const needsName = around.includes("typeof held");
  const under = named(around.replace("KEY", spelled));
  const from = needsName ? "held" : away ? `(${held} as any)` : held;
  const expression = shape
    .replaceAll("HELD", from)
    .replaceAll("K", `${under}`)
    .replace("?.ARGS", `?.${args}`)
    .replace("ARGS", args);
  const declared = [forHolder, needsName ? `const held = ${held};` : "", named(forKey), named(forCast)].filter(Boolean);
  return {
    name: `${holder}--${key}--${cast}--${use}.ts`,
    text: `${declared.map(line => line + "\n").join("")}console.log(${expression});\n`,
  };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
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
