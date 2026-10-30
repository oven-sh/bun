// A table, no seeds: a loop calls a function that hands it one of three things, and asks whether what it got is a certain one. Until that function hands it over, nothing in the program has asked for that one.
//
//   what it is x by which road it comes to the loop x in which turns x which loop, and where it stands x what else asks for it, ahead of the loop or behind it x what the loop asks
//
// A program holds every thing once, each with names of its own, so that no case asks for the thing of another. Over the programs each thing meets every combination of the rest.
type Kind = "function" | "class" | "value";
type Thing = {
  name: string;
  kind: Kind;
  /** What names it, given the mark of the case. */
  asks: (n: string) => string;
  /** What the chosen function hands over, where that is written otherwise than what names it. */
  hands?: (n: string) => string;
  declares?: (n: string) => string;
  declaresThere?: (n: string) => string;
  imports?: (n: string) => string;
};

const builtIn = (kind: Kind, name: string): Thing => ({ name, kind, asks: () => name });

const things: Thing[] = [
  {
    name: "a declared function",
    kind: "function",
    asks: n => `square${n}`,
    declares: n => `function square${n}(x: number): number { return x * x; }\n`,
  },
  {
    name: "a declared function of another file",
    kind: "function",
    asks: n => `squareThere${n}`,
    declaresThere: n => `export function squareThere${n}(x: number): number { return x * x; }\n`,
    imports: n => `squareThere${n}`,
  },
  {
    name: "a function read from the namespace of another file",
    kind: "function",
    asks: n => `there.cube${n}`,
    declaresThere: n => `export function cube${n}(x: number): number { return x * x * x; }\n`,
  },
  {
    name: "a static method",
    kind: "function",
    asks: n => `HasStatic${n}.square`,
    declares: n => `class HasStatic${n} { static square(x: number): number { return x * x; } }\n`,
  },
  {
    name: "a method on a prototype",
    kind: "function",
    asks: n => `HasMethod${n}.prototype.square`,
    declares: n => `class HasMethod${n} { square(x: number): number { return x * x; } }\n`,
  },
  {
    name: "a method of a literal",
    kind: "function",
    asks: n => `literal${n}.square`,
    declares: n => `const literal${n} = { square(x: number): number { return x * x; } };\n`,
  },
  {
    name: "a function declared inside a function",
    kind: "function",
    asks: n => `maker${n}()`,
    declares: n =>
      `function maker${n}(): Turns { function inner(x: number): number { return x * x; } return inner; }\n`,
  },
  { name: "an arrow written where it is asked for", kind: "function", asks: () => `((x: number) => x * x)` },
  builtIn("function", "Math.abs"),
  builtIn("function", "Math.trunc"),
  builtIn("function", "Math.round"),
  builtIn("function", "Number"),
  { name: "a declared class", kind: "class", asks: n => `Made${n}`, declares: n => `class Made${n} { v = 1; }\n` },
  {
    name: "a declared class of another file",
    kind: "class",
    asks: n => `MadeThere${n}`,
    declaresThere: n => `export class MadeThere${n} { v = 1; }\n`,
    imports: n => `MadeThere${n}`,
  },
  {
    name: "a class below a class",
    kind: "class",
    asks: n => `Below${n}`,
    declares: n => `class Below${n} extends Plain { w = 2; }\n`,
  },
  {
    name: "a class below a built-in class",
    kind: "class",
    asks: n => `Listed${n}`,
    declares: n => `class Listed${n} extends Array<number> { w = 2; }\n`,
  },
  {
    name: "a class that a function makes anew",
    kind: "class",
    asks: n => `classOf${n}()`,
    declares: n => `function classOf${n}(): Makes { return class { v = 1; }; }\n`,
  },
  builtIn("class", "Map"),
  builtIn("class", "Set"),
  builtIn("class", "WeakMap"),
  builtIn("class", "Date"),
  builtIn("class", "Error"),
  builtIn("class", "Array"),
  builtIn("class", "Object"),
  builtIn("value", "123456789012345678901234567890n"),
  builtIn("value", "7n"),
  builtIn("value", "1e300"),
  builtIn("value", "Number.NaN"),
  builtIn("value", "-0"),
  { name: "a text", kind: "value", asks: n => `"a text that nobody has asked for${n}"` },
  {
    name: "a text that is put together",
    kind: "value",
    asks: n => `"a text that is put together${n}"`,
    hands: n => `["a text that is", "put together${n}"].join(" ")`,
  },
  { name: "a template", kind: "value", asks: n => `\`a template of \${nine.length} parts${n}\`` },
  builtIn("value", "Symbol.iterator"),
  builtIn("value", "Symbol.asyncIterator"),
  { name: "a registered symbol", kind: "value", asks: n => `Symbol.for("asked${n}")` },
  {
    name: "the prototype of a declared class",
    kind: "value",
    asks: n => `Shaped${n}.prototype`,
    declares: n => `class Shaped${n} { v = 1; }\n`,
  },
  {
    name: "the strings of a tagged template",
    kind: "value",
    asks: n => `strings${n}\`a\``,
    declares: n => `function strings${n}(parts: TemplateStringsArray): TemplateStringsArray { return parts; }\n`,
  },
  {
    name: "a pattern that a function makes anew",
    kind: "value",
    asks: n => `pattern${n}()`,
    declares: n => `function pattern${n}(): RegExp { return /a+/; }\n`,
  },
  { name: "the namespace of another file", kind: "value", asks: () => "there" },
  { name: "what a CommonJS file exports", kind: "value", asks: () => `require("./asked-late.cjs")` },
  builtIn("value", "Math"),
  builtIn("value", "JSON"),
  builtIn("value", "Reflect"),
  builtIn("value", "Array.prototype"),
  builtIn("value", "Object.prototype"),
  builtIn("value", "Function.prototype"),
  builtIn("value", "globalThis"),
  builtIn("value", "console"),
];

const typeOf = { function: "Turns", class: "Makes", value: "unknown" };
const others: Record<Kind, [(turn: string, n: string) => string, (turn: string) => string]> = {
  function: [(turn, n) => `adder${n}(${turn})`, () => `(x: number) => x * 2`],
  class: [() => "Plain", () => "Other"],
  value: [turn => `${turn} - 1`, turn => `"no " + ${turn}`],
};

/** `chosen` writes the choice for the variable that holds the turn. `type` is the type of what is handed over, `first` something else of that type. */
type Written = {
  n: string;
  type: string;
  first: string;
  chosen: (turn: string) => string;
  inTurn: (turn: string) => string;
  hands: string;
  other: (turn: string) => string;
};
type Road = {
  name: string;
  declares: (w: Written) => string;
  opens?: (w: Written) => string;
  takes: (w: Written) => string;
  awaits?: boolean;
};

const returned = ({ n, type, chosen }: Written) => `function pick${n}(i: number): ${type} { return ${chosen("i")}; }\n`;
const roads: Road[] = [
  { name: "returned", declares: returned, takes: ({ n }) => `const got = pick${n}(i);` },
  {
    name: "left in a variable of the file",
    declares: ({ n, type, first, chosen }) =>
      `let kept${n}: ${type} = ${first};\nfunction fill${n}(i: number): void { kept${n} = ${chosen("i")}; }\n`,
    takes: ({ n }) => `fill${n}(i); const got = kept${n};`,
  },
  {
    name: "left in a field",
    declares: ({ n, type, first, chosen }) =>
      `const holder${n}: { it: ${type} } = { it: ${first} };\nfunction fill${n}(i: number): void { holder${n}.it = ${chosen("i")}; }\n`,
    takes: ({ n }) => `fill${n}(i); const got = holder${n}.it;`,
  },
  {
    name: "left in a list",
    declares: ({ n, type, first, chosen }) =>
      `const list${n}: ${type}[] = [${first}];\nfunction fill${n}(i: number): void { list${n}[0] = ${chosen("i")}; }\n`,
    takes: ({ n }) => `fill${n}(i); const got = list${n}[0];`,
  },
  {
    name: "returned by a method",
    declares: ({ n, type, chosen }) => `const chooser${n} = { pick(i: number): ${type} { return ${chosen("i")}; } };\n`,
    takes: ({ n }) => `const got = chooser${n}.pick(i);`,
  },
  {
    name: "returned by a getter",
    declares: ({ n, type, chosen }) =>
      `const chooser${n} = { turn: 0, get it(): ${type} { return ${chosen("this.turn")}; } };\n`,
    takes: ({ n }) => `chooser${n}.turn = i; const got = chooser${n}.it;`,
  },
  {
    name: "returned by a callback of a built-in",
    declares: ({ n, type, chosen }) =>
      `function pick${n}(i: number): ${type} { return [i].map((j): ${type} => ${chosen("j")})[0]; }\n`,
    takes: ({ n }) => `const got = pick${n}(i);`,
  },
  {
    name: "yielded",
    declares: ({ n, type, chosen }) =>
      `function* all${n}(): Generator<${type}, void, void> { for (let i = 0; ; i++) yield ${chosen("i")}; }\n`,
    opens: ({ n }) => `const source${n} = all${n}();`,
    takes: ({ n, type }) => `const got = source${n}.next().value as ${type};`,
  },
  {
    name: "thrown",
    declares: ({ n, chosen }) => `function pick${n}(i: number): never { throw ${chosen("i")}; }\n`,
    takes: ({ n, type, first }) =>
      `let got: ${type} = ${first}; try { pick${n}(i); } catch (error) { got = error as ${type}; }`,
  },
  {
    name: "returned through a function of another file",
    declares: returned,
    takes: ({ n }) => `const got = through(() => pick${n}(i));`,
  },
  {
    name: "returned from two calls down",
    declares: ({ n, type, chosen }) =>
      `function inner${n}(i: number): ${type} { return ${chosen("i")}; }\nfunction pick${n}(i: number): ${type} { return inner${n}(i); }\n`,
    takes: ({ n }) => `const got = pick${n}(i);`,
  },
  {
    name: "the default of a parameter",
    declares: ({ n, type, hands }) => `function pick${n}(i: number, it: ${type} = ${hands}): ${type} { return it; }\n`,
    takes: ({ n, inTurn, other }) => `const got = ${inTurn("i")} ? pick${n}(i) : pick${n}(i, ${other("i")});`,
  },
  {
    name: "awaited",
    declares: ({ n, type, chosen }) =>
      `async function pick${n}(i: number): Promise<${type}> { return ${chosen("i")}; }\n`,
    takes: ({ n }) => `const got = await pick${n}(i);`,
    awaits: true,
  },
];

const turns: { name: string; text: (turn: string) => string }[] = [
  { name: "every third turn", text: turn => `${turn} % 3 === 2` },
  { name: "the first turn", text: turn => `${turn} === 0` },
  { name: "the last turn", text: turn => `${turn} === 8` },
  { name: "from the fifth turn on", text: turn => `${turn} >= 4` },
];

const loops: { name: string; text: (body: string) => string }[] = [
  { name: "for", text: body => `for (let i = 0; i < 9; i++) {\n${body}}\n` },
  { name: "while", text: body => `let i = 0;\nwhile (i < 9) {\n${body}i++;\n}\n` },
  { name: "for of", text: body => `for (const i of nine) {\n${body}}\n` },
];
const places = ["at the top of the file", "in a function"];
const elsewhere = [
  "nobody else asks",
  "asked ahead of the loop",
  "compared with itself behind the loop",
  "handed on behind the loop",
];

const whether = (condition: string) => `total += ${condition} ? 100 + i : 1;`;
const common: { name: string; text: (asks: string, n: string, type: string) => string }[] = [
  { name: "the same", text: asks => whether(`got === ${asks}`) },
  { name: "not the same", text: asks => `total += got !== ${asks} ? 1 : 100 + i;` },
  { name: "a switch", text: asks => `switch (got) { case ${asks}: total += 100 + i; break; default: total += 1; }` },
  { name: "a small function asks", text: (_, n) => whether(`isIt${n}(got)`) },
  { name: "the same as in the turn before", text: () => `${whether("got === last")} last = got;` },
  { name: "found in a list", text: (asks, _, type) => whether(`([${asks}] as ${type}[]).includes(got)`) },
];
const tests: Record<Kind, typeof common> = {
  function: [
    ...common,
    { name: "called twice", text: (_, n) => `total += twice${n}(got, i + 1);` },
    { name: "called", text: () => `total += got(i + 1);` },
  ],
  class: [
    ...common,
    { name: "what it makes is asked instanceof", text: asks => whether(`new got() instanceof ${asks}`) },
    {
      name: "the prototype of what it makes",
      text: asks => whether(`Object.getPrototypeOf(new got()) === ${asks}.prototype`),
    },
  ],
  value: [
    ...common,
    { name: "Object.is", text: asks => whether(`Object.is(got, ${asks})`) },
    { name: "a key of a map", text: asks => `total += new Map<unknown, number>([[${asks}, 100 + i]]).get(got) ?? 1;` },
  ],
};

const combinations = roads.length * turns.length * loops.length * places.length * elsewhere.length * tests.value.length;
const laidOut = [[], ["--aot-limit=MaxWarmCodeValues:1"], ["--aot-heat=everything-is-hot"]];
export const programs = laidOut.length * combinations;

/** The flags that the program of that number is built with. */
export const flagsOf = (index: number): string[] => laidOut[Math.floor(index / combinations)];

function caseOf(thing: Thing, position: number, combination: number): string {
  const take = <T>(from: T[]): T => {
    const taken = from[combination % from.length];
    combination = Math.floor(combination / from.length);
    return taken;
  };
  const [test, asked, place, loop, turn, road] = [
    take(tests[thing.kind]),
    take(elsewhere),
    take(places),
    take(loops),
    take(turns),
    take(roads),
  ];
  const n = `_${position}`;
  const [type, asks, hands, [odd, even]] = [
    typeOf[thing.kind],
    thing.asks(n),
    (thing.hands ?? thing.asks)(n),
    others[thing.kind],
  ];
  const other = (at: string) => `${at} % 2 === 1 ? ${odd(at, n)} : ${even(at)}`;
  const written: Written = {
    n,
    type,
    first: even("0"),
    chosen: at => `${turn.text(at)} ? ${hands} : ${other(at)}`,
    inTurn: turn.text,
    hands,
    other,
  };
  const label = JSON.stringify(
    `${thing.name} | ${road.name} | ${turn.name} | ${loop.name} ${place} | ${asked} | ${test.name}:`,
  );
  const work = `let total = 0;\nlet last: ${type} | undefined;\n${asked === elsewhere[1] ? `sink(${asks});\n` : ""}${road.opens ? `${road.opens(written)}\n` : ""}${loop.text(`${road.takes(written)}\n${test.text(asks, n, type)}\n`)}${asked === elsewhere[2] ? `sink(${asks} === ${asks});\n` : asked === elsewhere[3] ? `sink(${asks});\n` : ""}`;
  const helpers =
    thing.kind !== "function"
      ? ""
      : `function twice${n}(f: Turns, x: number): number { return f(f(x)); }\nfunction adder${n}(n: number): Turns { return x => x + n; }\n`;
  const [marked, waits] = road.awaits ? ["async ", "await "] : ["", ""];
  return `${helpers}${road.declares(written)}${thing.declares?.(n) ?? ""}function isIt${n}(it: ${type}): boolean { return it === ${asks}; }
${place === places[0] ? `{\n${work}console.log(${label}, total, typeof last);\n}` : `${marked}function run${n}() {\n${work}return total + " " + typeof last;\n}\nconsole.log(${label}, ${waits}run${n}());`}
`;
}

export function programOf(index: number): { file: string; text: string; files: Record<string, string> } {
  // Neighbors in the table differ in what the loop asks alone: a stride that shares no factor with the length of the table takes a run's share from all over it. Each thing starts at a place of its own.
  const at = (position: number) => ((index % combinations) * 7919 + position * 1237) % combinations;
  const named = things.flatMap((thing, position) => thing.imports?.(`_${position}`) ?? []);
  return {
    file: "main.ts",
    text: `import * as there from "./there.ts";
import { through, ${named.join(", ")} } from "./there.ts";
declare function require(name: string): unknown;
type Turns = (x: number) => number;
type Makes = { new (): object; prototype: object };
class Plain { u = 0; }
class Other { u = 1; }
const nine = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const sunk: unknown[] = [];
function sink(it: unknown): void { sunk.push(it); }
${things.map((thing, position) => caseOf(thing, position, at(position))).join("")}console.log(sunk.map(it => typeof it === "boolean" ? String(it) : typeof it).join(" "));
`,
    files: {
      "there.ts": `export function through<T>(make: () => T): T { return make(); }\n${things.map((thing, position) => thing.declaresThere?.(`_${position}`) ?? "").join("")}`,
      "asked-late.cjs": `exports.v = 1;\n`,
    },
  };
}
