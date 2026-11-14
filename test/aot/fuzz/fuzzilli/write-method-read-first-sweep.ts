// The method of a call is read in front of its arguments, and an argument takes that method away: the built-in class and its method, times how the program's own method lies over it and how it is taken
// away, times how the argument runs, times where the receiver stands, times what the argument looks up, times where the loop stands, times whether the receiver is fresh in each turn, times the kind of
// file. Each program holds one of each and nothing else, and is built alone.
//
//   bun write-method-read-first-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<method>--<taken>--<argument>--<receiver>--<lookups>--<loop>--<fresh>.ts or .mjs
//   bun write-method-read-first-sweep.ts count
//   bun write-method-read-first-sweep.ts named <pattern> <folder> [most]
//
// In `table.set(key, make())` the language reads `table.set` first, then runs `make()`, then calls what it read. Where `table` is a Map by its type but has a `set` of the program's own, on itself or
// through a class below Map, and `make()` deletes that method or lays the prototype of Map under the object, the program's own method is still the one to be called. A compiler that decides behind the
// arguments which function the call means calls the built-in one. What an object looks like to it may also hang on how often the object's kind has been looked at, so the call stands in a loop of forty turns
// and the argument looks something up. The program counts how often its own method ran.
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

type Kind = {
  name: string;
  base: string;
  typed: string;
  made: string;
  method: string;
  takes: string;
  takesTyped: string;
  hands: string;
  call: (receiver: string, value: string) => string;
  looks: ((receiver: string) => string)[];
};

const kinds: Kind[] = [
  {
    name: "set-of-a-map",
    base: "Map",
    typed: "Map<string, number>",
    made: "()",
    method: "set",
    takes: "k, v",
    takesTyped: "k: string, v: number",
    hands: "k, v",
    call: (r, v) => `${r}.set("k", ${v})`,
    looks: [r => `(${r}.has("z") ? 1 : 0)`, r => `(${r}.get("z") ?? 0)`, r => `${r}.size`],
  },
  {
    name: "add-of-a-set",
    base: "Set",
    typed: "Set<number>",
    made: "()",
    method: "add",
    takes: "v",
    takesTyped: "v: number",
    hands: "v",
    call: (r, v) => `${r}.add(${v})`,
    looks: [r => `(${r}.has(9) ? 1 : 0)`, r => `${r}.size`, r => `(${r}.has(8) ? 1 : 0)`],
  },
  {
    name: "get-of-a-map",
    base: "Map",
    typed: "Map<string, number>",
    made: "()",
    method: "get",
    takes: "k",
    takesTyped: "k: string",
    hands: "k",
    call: (r, v) => `${r}.get(String(${v}))`,
    looks: [r => `(${r}.has("z") ? 1 : 0)`, r => `${r}.size`, r => `(${r}.has("y") ? 1 : 0)`],
  },
  {
    name: "push-of-a-list",
    base: "Array",
    typed: "number[]",
    made: "()",
    method: "push",
    takes: "v",
    takesTyped: "v: number",
    hands: "v",
    call: (r, v) => `${r}.push(${v})`,
    looks: [r => `${r}.length`, r => `(${r}.includes(9) ? 1 : 0)`, r => `(${r}.at(0) ?? 0)`],
  },
  {
    name: "fill-of-a-view",
    base: "Uint8Array",
    typed: "Uint8Array",
    made: "(4)",
    method: "fill",
    takes: "v",
    takesTyped: "v: number",
    hands: "v",
    call: (r, v) => `${r}.fill(${v})`,
    looks: [r => `${r}.length`, r => `(${r}.includes(9) ? 1 : 0)`, r => `(${r}.at(0) ?? 0)`],
  },
  {
    name: "set-time-of-a-date",
    base: "Date",
    typed: "Date",
    made: "(0)",
    method: "setTime",
    takes: "v",
    takesTyped: "v: number",
    hands: "v",
    call: (r, v) => `${r}.setTime(${v})`,
    looks: [r => `${r}.getTime()`, r => `${r}.getUTCDay()`, r => `${r}.valueOf()`],
  },
];

const takens = [
  "a-class-below--the-chain-is-swapped",
  "a-method-of-its-own--deleted",
  "a-class-below--its-method-is-deleted",
  "a-method-of-its-own--exchanged",
  "a-class-below--nothing-happens",
] as const;

const argumentsRun = ["a-closure-handed-in", "awaited", "a-function-of-the-file", "an-arrow-called-in-place"] as const;

const receivers = ["a-field-of-a-class", "the-parameter", "a-field-of-a-record", "a-variable-of-the-file"] as const;

const lookups = ["one-lookup", "no-lookup", "three-lookups", "one-lookup-behind-the-call"] as const;

const loops = ["the-loop-at-the-top", "the-loop-in-a-function", "the-call-in-the-loop"] as const;

const freshes = ["fresh-in-each-turn", "one-kept"] as const;

const files = ["ts", "mjs"] as const;

const all =
  kinds.length * takens.length * argumentsRun.length * receivers.length * lookups.length * loops.length * freshes.length * files.length; // prettier-ignore

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const taken = pick(takens);
  const runs = pick(argumentsRun);
  const stands = pick(receivers);
  const file = pick(files);
  const looked = pick(lookups);
  const loop = pick(loops);
  const fresh = pick(freshes);
  const kind = pick(kinds);
  const ts = file === "ts";
  const of = (type: string) => (ts ? `: ${type}` : "");
  const any = (text: string) => (ts ? `(${text} as any)` : text);
  const below = taken.startsWith("a-class-below");
  const awaited = runs === "awaited";
  const inLoop = loop === "the-call-in-the-loop";
  const { base, typed, method } = kind;
  const takes = ts ? kind.takesTyped : kind.takes;

  // The receiver as the function of the call names it, and as the loop names it.
  const held = stands === "a-field-of-a-class" || stands === "a-field-of-a-record";
  const inLoopName = held ? "box.table" : "table";
  const receiver = inLoopName;
  const holderType = stands === "a-field-of-a-class" ? "Box" : stands === "a-field-of-a-record" ? `{ table: ${typed} }` : typed; // prettier-ignore
  const holder = held ? "box" : "table";

  const declared = [
    "let calls = 0,\n  others = 0,\n  seen = 0;",
    below
      ? `class Own extends ${base}${ts && base === "Map" ? "<string, number>" : ts && (base === "Set" || base === "Array") ? "<number>" : ""} {\n  ${method}(${takes})${of("any")} {\n    calls++;\n    return super.${method}(${kind.hands});\n  }\n}`
      : `const own = function (${ts ? `this: ${typed}, ` : ""}${takes})${of("any")} {\n  calls++;\n  return ${any(`${base}.prototype.${method}`)}.call(this, ${kind.hands});\n};`,
    taken === "a-method-of-its-own--exchanged" &&
      `const other = function (${ts ? `this: ${typed}, ` : ""}${takes})${of("any")} {\n  others++;\n  return ${any(`${base}.prototype.${method}`)}.call(this, ${kind.hands});\n};`,
    taken === "a-class-below--its-method-is-deleted" && `const kept = Own.prototype.${method};`,
    stands === "a-field-of-a-class" &&
      (ts
        ? `class Box {\n  table: ${typed};\n  constructor(table: ${typed}) {\n    this.table = table;\n  }\n}`
        : "class Box {\n  constructor(table) {\n    this.table = table;\n  }\n}"),
    `function make()${of(typed)} {\n  ${below ? `return new Own${kind.made};` : `const made = new ${base}${ts && base === "Map" ? "<string, number>" : ts && (base === "Set" || base === "Array") ? "<number>" : ""}${kind.made};\n  ${any("made")}.${method} = own;\n  return made;`}\n}`,
  ];

  const away = (r: string) =>
    ({
      "a-class-below--the-chain-is-swapped": `Object.setPrototypeOf(${r}, ${base}.prototype);`,
      "a-method-of-its-own--deleted": `delete ${any(r)}.${method};`,
      "a-class-below--its-method-is-deleted": `delete ${any("Own.prototype")}.${method};`,
      "a-method-of-its-own--exchanged": `${any(r)}.${method} = other;`,
      "a-class-below--nothing-happens": "",
    })[taken];
  // What puts the program's own method back in front of a turn.
  const back = (r: string) =>
    ({
      "a-class-below--the-chain-is-swapped": fresh === "one-kept" ? `Object.setPrototypeOf(${r}, Own.prototype);` : "",
      "a-method-of-its-own--deleted": fresh === "one-kept" ? `${any(r)}.${method} = own;` : "",
      "a-class-below--its-method-is-deleted": `${any("Own.prototype")}.${method} = kept;`,
      "a-method-of-its-own--exchanged": fresh === "one-kept" ? `${any(r)}.${method} = own;` : "",
      "a-class-below--nothing-happens": "",
    })[taken];
  const sum = (r: string) =>
    looked === "one-lookup"
      ? kind.looks[0](r)
      : looked === "three-lookups"
        ? kind.looks.map(look => look(r)).join(" + ")
        : "0";
  const body = (r: string) => [away(r), `return ${sum(r)};`].filter(Boolean).join(" ");

  const arrow = `${awaited ? "async " : ""}() => { ${body(inLoopName)} }`;
  const value =
    runs === "a-closure-handed-in"
      ? "given()"
      : awaited
        ? "await given()"
        : runs === "a-function-of-the-file"
          ? `away(${receiver})`
          : `(() => { ${body(receiver)} })()`;
  const handsIn = runs === "a-closure-handed-in" || awaited;
  const behind = looked === "one-lookup-behind-the-call" ? `seen += ${kind.looks[0](receiver)};` : "";
  const theCall = [`${kind.call(receiver, value)};`, behind].filter(Boolean).join("\n  ");

  const ofTheFile = stands === "a-variable-of-the-file";
  const parameters = [!ofTheFile && `${holder}${of(holderType)}`, handsIn && `given${of(awaited ? "() => Promise<number>" : "() => number")}`].filter(Boolean).join(", "); // prettier-ignore
  const handed = [!ofTheFile && holder, handsIn && arrow].filter(Boolean).join(", ");
  const holds = stands === "a-field-of-a-class" ? "new Box(make())" : stands === "a-field-of-a-record" ? "{ table: make() }" : "make()"; // prettier-ignore

  const turn = [
    fresh === "fresh-in-each-turn" &&
      (ofTheFile ? `table = ${holds};` : `const ${holder}${of(holderType)} = ${holds};`),
    back(inLoopName),
    inLoop && handsIn && `const given = ${arrow};`,
    inLoop ? theCall.replaceAll("\n  ", "\n") : `${awaited ? "await " : ""}put(${handed});`,
  ]
    .filter(Boolean)
    .join("\n")
    .replaceAll("\n", "\n  ");
  const kept1 = fresh === "one-kept" && !ofTheFile && `const ${holder}${of(holderType)} = ${holds};`;
  const theLoop = `for (let turn = 0; turn < 40; turn++) {\n  ${turn}\n}`;
  const text = [
    ...declared,
    ofTheFile && `let table${of(typed)} = make();`,
    runs === "a-function-of-the-file" && `function away(table${of(typed)})${of("number")} {\n  ${body("table").replace("; return", ";\n  return")}\n}`, // prettier-ignore
    !inLoop && `${awaited ? "async " : ""}function put(${parameters}) {\n  ${theCall}\n}`,
    loop === "the-loop-in-a-function"
      ? `${awaited ? "async " : ""}function main() {\n  ${[kept1, theLoop].filter(Boolean).join("\n").replaceAll("\n", "\n  ")}\n}\n${awaited ? "await " : ""}main();`
      : [kept1, theLoop].filter(Boolean).join("\n"),
    'console.log(calls, others, "of 40", seen);',
    "export {};",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    name: `${kind.name}--${taken}--${runs}--${stands}--${looked}--${loop}--${fresh}.${file}`,
    text: text + "\n",
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
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, printThroughBranch(program.text, at, program.name));
  }
  console.log(Math.min(count, all));
}
