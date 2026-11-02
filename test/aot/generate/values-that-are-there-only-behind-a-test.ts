// The programs of values-that-are-there-only-behind-a-test. `bun test/aot/generate.ts values-that-are-there-only-behind-a-test <where>` writes them.
// A function gives back one of several records, and only some of them have a certain member. A variable is stored below the first call of a function that reads it behind a flag.
// The program looks at such a value only behind its own test, in a loop that runs often, after the value went through calls, returns, meetings of two ways, closures, generators and patterns.
// A loop of the library runs ahead of the store too, and by the names of its members an iterator of the program that reads the variable could be what it walks.
// Each program prints what plain Bun prints, also for the records that lack the member and for the calls ahead of the store.
import { programsOf } from "../generate";
import { values as shapedForOneWayToMove } from "./what-is-moved-ahead-of-a-loop";

/** The value that is not always there. `make` is an expression of `i`, `look` one of `p` and `j` that gives a number. */
type Part = { type: string; declarations?: string; make: string; look: string };
const parts: Record<string, Part> = {
  "a-list-of-integers": { type: "number[]", make: "[i, i + 1, i + 2]", look: "p[j % 3]! + p.length" },
  "a-list-of-fractions": { type: "number[]", make: "[i + 0.5, i + 1.5, i + 2.5]", look: "p[j % 3]! * 2" },
  "a-list-of-texts": {
    type: "string[]",
    make: '["a" + i, "bc" + i]',
    look: "p[j & 1]!.length + p[j & 1]!.charCodeAt(0)",
  },
  "a-float64-array": {
    type: "Float64Array",
    make: "new Float64Array([i, i + 1, i + 2])",
    look: "p[j % 3]! + p.length",
  },
  "a-uint8-array": {
    type: "Uint8Array",
    make: "new Uint8Array([i, i + 1, i + 2, i + 3])",
    look: "p[j & 3]! + p.byteLength",
  },
  "a-text": { type: "string", make: '"text" + i', look: "p.length + p.charCodeAt(j % p.length)" },
  "a-closure": { type: "(x: number) => number", make: "(x: number) => x + i", look: "p(j)" },
  "a-closure-over-a-list": {
    type: "(x: number) => number",
    declarations:
      "function picker(list: number[]): (x: number) => number {\n  return x => list[x % 3]! + list.length;\n}",
    make: "picker([i, i + 1, i + 2])",
    look: "p(j)",
  },
  "an-instance": {
    type: "Point",
    declarations:
      "class Point {\n  constructor(\n    public x: number,\n    public y: number,\n  ) {}\n  along(j: number): number {\n    return this.x * j + this.y;\n  }\n}",
    make: "new Point(i, i + 1)",
    look: "p.x + p.along(j)",
  },
  "a-record-in-a-record": {
    type: "{ inner: { deep: number; list: number[] } }",
    make: "{ inner: { deep: i, list: [i, i + 1] } }",
    look: "p.inner.deep + p.inner.list[j & 1]!",
  },
  "a-map": {
    type: "Map<number, number>",
    make: "new Map([\n      [0, i],\n      [1, i + 1],\n    ])",
    look: "p.get(j & 1)! + p.size",
  },
  "a-set": { type: "Set<number>", make: "new Set([i, i + 1, 3])", look: "(p.has(j) ? 5 : 7) + p.size" },
  "a-fraction": { type: "number", make: "i + 0.5", look: "p * 2 + j" },
  "a-bigint": { type: "bigint", make: "BigInt(i) << 70n", look: "Number((p >> 70n) + BigInt(j))" },
  "a-date": { type: "Date", make: "new Date(i * 1000)", look: "p.getTime() / 1000 + j" },
  "a-pattern": {
    type: "RegExp",
    make: 'new RegExp("a{" + (i % 3) + "}b", "g")',
    look: "p.source.length + p.lastIndex + j",
  },
};

/** Who makes the record. `RECORD` stands for the statements that return one for `i`; `source` is an expression of `i`. */
type Source = { declarations: string; source: string };
const sources: Record<string, Source> = {
  "a-function": { declarations: "function make(i: number): Result {\n  RECORD\n}", source: "make(i)" },
  "an-arrow-function": { declarations: "const make = (i: number): Result => {\n  RECORD\n};", source: "make(i)" },
  "a-getter": {
    declarations:
      "class Source {\n  constructor(public seed: number) {}\n  get now(): Result {\n    const i = this.seed;\n    RECORD\n  }\n}",
    source: "new Source(i).now",
  },
  "a-method": {
    declarations:
      "class Source {\n  constructor(public seed: number) {}\n  make(): Result {\n    const i = this.seed;\n    RECORD\n  }\n}",
    source: "new Source(i).make()",
  },
  "a-static-method": {
    declarations: "class Source {\n  static make(i: number): Result {\n    RECORD\n  }\n}",
    source: "Source.make(i)",
  },
  "a-generator": {
    declarations: "function* makes(i: number): Generator<Result, Result> {\n  RECORD\n}",
    source: "makes(i).next().value",
  },
  "a-function-that-calls-another": {
    declarations:
      "function inner(i: number): Result {\n  RECORD\n}\nfunction make(i: number): Result {\n  return i % 5 === 4 ? inner(i + 1) : inner(i);\n}",
    source: "make(i)",
  },
};
const record = `if (i % 7 === 3) return { kind: 1, name: "n" + i };
  if (i % 11 === 5) return { kind: 2 };
  return { kind: 0, part: MAKE };`;

const arms = (r: string, part = `${r}.part`, name = `${r}.name`, kind = `${r}.kind`) =>
  `if (${kind} === 0) sum = mix(sum, LOOK(${part}));\n    else sum = mix(sum, ${kind} === 1 ? ${name}.length : -1);`;

/** How the record gets from its maker to the loop. `SOURCE(..)` stands for the maker's call. `isLoose`: the members are read where TypeScript no longer knows the kind. */
type Road = { text: string; isLoose?: boolean; isAsync?: boolean };
const roads: Record<string, Road> = {
  "straight": {
    text: `function work(i: number, n: number): number {\n  const r = SOURCE(i);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
  "through-a-call": {
    text: `function use(r: Result, n: number): number {\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}\nfunction work(i: number, n: number): number {\n  return use(SOURCE(i), n);\n}`,
  },
  "through-a-return": {
    text: `function pass(i: number): Result {\n  const r = SOURCE(i);\n  if (r.kind === 2) return SOURCE(i + 1);\n  return r;\n}\nfunction work(i: number, n: number): number {\n  const r = pass(i);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
  "through-a-meeting-of-two-ways": {
    text: `function work(i: number, n: number): number {\n  let r: Result;\n  if (i & 1) r = SOURCE(i);\n  else r = SOURCE(i + 7);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
  "through-a-closure": {
    text: `function work(i: number, n: number): number {\n  const r = SOURCE(i);\n  const look = (j: number, sum: number): number => {\n    ${arms("r")}\n    return sum;\n  };\n  let sum = 0;\n  for (let j = 0; j < n; j++) sum = look(j, sum);\n  return sum;\n}`,
  },
  "through-a-generator": {
    text: `function* pass(i: number, n: number): Generator<Result> {\n  const r = SOURCE(i);\n  for (let j = 0; j < n; j++) yield r;\n}\nfunction work(i: number, n: number): number {\n  let sum = 0;\n  let j = 0;\n  for (const r of pass(i, n)) {\n    ${arms("r")}\n    j++;\n  }\n  return sum;\n}`,
  },
  "through-a-pattern": {
    text: `function work(i: number, n: number): number {\n  const { kind, part, name } = SOURCE(i);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r", "part!", "name!", "kind")}\n  }\n  return sum;\n}`,
    isLoose: true,
  },
  "through-a-pattern-in-a-parameter": {
    text: `function use({ kind, part, name }: Result, n: number): number {\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r", "part!", "name!", "kind")}\n  }\n  return sum;\n}\nfunction work(i: number, n: number): number {\n  return use(SOURCE(i), n);\n}`,
    isLoose: true,
  },
  "through-a-variable-of-the-loop": {
    text: `function work(i: number, n: number): number {\n  let r = SOURCE(i);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n    if ((j & 3) === 3) r = SOURCE(i + j);\n  }\n  return sum;\n}`,
  },
  "through-a-default-of-a-parameter": {
    text: `function use(n: number, i: number, r: Result = SOURCE(i)): number {\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}\nfunction work(i: number, n: number): number {\n  return use(n, i);\n}`,
  },
  "through-a-field-of-a-new-object": {
    text: `function work(i: number, n: number): number {\n  const outer = { r: SOURCE(i), n };\n  let sum = 0;\n  for (let j = 0; j < outer.n; j++) {\n    const r = outer.r;\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
  "through-a-new-list": {
    text: `function work(i: number, n: number): number {\n  const pair = [SOURCE(i), SOURCE(i + 1)];\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    const r = pair[j & 1]!;\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
  "through-a-finally": {
    text: `function work(i: number, n: number): number {\n  let sum = 0;\n  let r: Result;\n  try {\n    r = SOURCE(i);\n  } finally {\n    sum += 1;\n  }\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
  "through-an-await": {
    text: `async function later(i: number): Promise<Result> {\n  return SOURCE(i);\n}\nasync function work(i: number, n: number): Promise<number> {\n  const r = await later(i);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}`,
    isAsync: true,
  },
  "through-a-spread": {
    text: `function work(i: number, n: number): number {\n  const r = { ...SOURCE(i) };\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
  "through-rest-parameters": {
    text: `function use(n: number, ...given: Result[]): number {\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    const r = given[j % given.length]!;\n    ${arms("r")}\n  }\n  return sum;\n}\nfunction work(i: number, n: number): number {\n  return use(n, SOURCE(i), SOURCE(i + 2));\n}`,
  },
  "to-a-switch": {
    text: `function work(i: number, n: number): number {\n  const r = SOURCE(i);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    switch (r.kind) {\n      case 0:\n        sum = mix(sum, LOOK(r.part));\n        break;\n      case 1:\n        sum = mix(sum, r.name.length);\n        break;\n      default:\n        sum = mix(sum, -1);\n    }\n  }\n  return sum;\n}`,
  },
  "to-a-loop-behind-the-test": {
    text: `function work(i: number, n: number): number {\n  const r = SOURCE(i);\n  let sum = 0;\n  if (r.kind === 0) for (let j = 0; j < n; j++) sum = mix(sum, LOOK(r.part));\n  else if (r.kind === 1) for (let j = 0; j < n; j++) sum = mix(sum, r.name.length + j);\n  return sum;\n}`,
  },
  "to-a-test-in-the-condition-of-the-loop": {
    text: `function work(i: number, n: number): number {\n  const r = SOURCE(i);\n  let sum = 0;\n  for (let j = 0; r.kind === 0 && j < n; j++) sum = mix(sum, LOOK(r.part));\n  return sum;\n}`,
  },
  "to-a-test-that-most-turns-skip": {
    text: `function work(i: number, n: number): number {\n  const r = SOURCE(i);\n  let sum = 0;\n  for (let j = 0; j < n; j++) {\n    sum += j;\n    if ((j & 7) !== 7) continue;\n    ${arms("r")}\n  }\n  return sum;\n}`,
  },
};

function programOfRecords(partName: string, sourceName: string, roadName: string): string {
  const part = parts[partName];
  const source = sources[sourceName];
  const road = roads[roadName];
  const look = (p: string) => `(${part.look.replace(/\bp\b/g, p)})`;
  const sentence =
    `${sourceName} gives back records of which some hold ${partName}; a record goes ${roadName}`.replaceAll("-", " ");
  const spelledRoad = road.text
    .replace(/LOOK\(([^()]*)\)/g, (_, p) => look(p))
    .replace(/SOURCE\(([^()]*)\)/g, (_, i) =>
      source.source.replace(/\bi\b/g, i === "i" ? "i" : `(${i})`).replace(/\(\((.*)\)\)/, "($1)"),
    );
  return `// ${sentence[0].toUpperCase()}${sentence.slice(1)}, and a loop looks at the member only behind a test of the kind.
type Part = ${part.type};
type Result = ${road.isLoose ? "{ kind: number; part?: Part; name?: string }" : "{ kind: 0; part: Part } | { kind: 1; name: string } | { kind: 2 }"};
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
${part.declarations ? part.declarations + "\n" : ""}${source.declarations.replace("RECORD", record.replace("MAKE", part.make).replaceAll("\n", "\n" + (source.declarations.startsWith("class") ? "  " : "")))}
${spelledRoad}
let total = 0;
for (let i = 0; i < 400; i++) {
  const sum = ${road.isAsync ? "await " : ""}work(i, i % 13 === 6 ? 0 : 24);
  total = mix(total, sum);
  if (i < 24) console.log(i, sum);
}
console.log(total);
`;
}

/** How a function that may run ahead of the store reads the variable. `PART` stands for the variable; every text declares `reader(j)`, or `walk(n)` in its place. */
const readers: Record<string, { text: string; walks?: boolean; holds?: boolean }> = {
  "straight": { text: "function reader(j: number): number {\n  return ready ? LOOK(PART) : j;\n}" },
  "through-a-call": {
    text: "function use(p: Part, j: number): number {\n  return LOOK(p);\n}\nfunction reader(j: number): number {\n  return ready ? use(PART, j) : j;\n}",
  },
  "through-a-return": {
    text: "function get(): Part {\n  return PART;\n}\nfunction reader(j: number): number {\n  return ready ? LOOK(get()) : j;\n}",
  },
  "through-a-meeting-of-two-ways": {
    text: "function reader(j: number): number {\n  const p = ready ? PART : spare;\n  return LOOK(p);\n}",
  },
  "through-a-closure": {
    text: "function reader(j: number): number {\n  const look = () => LOOK(PART);\n  return ready ? look() : j;\n}",
  },
  "through-a-generator": {
    text: "function* walk(n: number): Generator<number> {\n  for (let j = 0; j < n; j++) yield ready ? LOOK(PART) : j;\n}",
    walks: true,
  },
  "through-a-pattern": {
    text: "function reader(j: number): number {\n  if (!ready) return j;\n  const { held } = holder;\n  return LOOK(held);\n}",
    holds: true,
  },
  "through-a-getter": {
    text: "const door = {\n  get now(): Part {\n    return PART;\n  },\n};\nfunction reader(j: number): number {\n  return ready ? LOOK(door.now) : j;\n}",
  },
};
const declarations = ["const", "let", "var"];

function programOfVariables(partName: string, readerName: string, declaration: string, isInFunction: boolean): string {
  const part = parts[partName];
  const reader = readers[readerName];
  const look = (p: string) => `(${part.look.replace(/\bp\b/g, p)})`;
  const make = (i: string) => part.make.replace(/\bi\b/g, i);
  const variable = reader.holds ? "holder" : "part";
  const body = `${reader.text.replace(/LOOK\(([^()]*(?:\(\))?)\)/g, (_, p) => look(p)).replaceAll("PART", "part")}
let ready = false;
const spare: Part = ${make("seed + 40")};
const early = ${reader.walks ? "sumOf(walk(24))" : "each(24, reader)"};
${declaration} ${variable}${reader.holds ? "" : ": Part"} = ${reader.holds ? `{ held: ${make("seed")} }` : make("seed")};
ready = true;
const late = ${reader.walks ? "sumOf(walk(24))" : "each(24, reader)"};`;
  const sentence =
    `a function that reads ${partName} ${readerName} out of a ${declaration} of ${isInFunction ? "a function" : "the module"} runs ahead of the store`.replaceAll(
      "-",
      " ",
    );
  return `// ${sentence[0].toUpperCase()}${sentence.slice(1)}, in a loop, and looks at the value only behind a flag that is set below the store.
type Part = ${part.type};
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
${part.declarations ? part.declarations + "\n" : ""}function each(n: number, step: (j: number) => number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) sum = mix(sum, step(j));
  return sum;
}
function sumOf(steps: Iterable<number>): number {
  let sum = 0;
  for (const step of steps) sum = mix(sum, step);
  return sum;
}
${
  isInFunction
    ? `function main(seed: number): number {\n  ${body.replaceAll("\n", "\n  ")}\n  return mix(early, late);\n}\nlet total = 0;\nfor (let seed = 0; seed < 60; seed++) {\n  const sum = main(seed);\n  total = mix(total, sum);\n  if (seed < 6) console.log(seed, sum);\n}\nconsole.log(total);`
    : `const seed = process.argv.length;\n${body}\nconsole.log(early, late === each(24, j => j), mix(early, late) !== 0);`
}
`;
}

/** How next() of an iterator of the program gets at the variable. `PART` stands for the variable, `LOOK(..)` for the look; `outside` stands beside next(). */
const steps: Record<string, { outside?: string; look: string; holds?: boolean }> = {
  "straight": { look: "LOOK(PART)" },
  "through-a-call": {
    outside: "function use(p: Part, j: number): number {\n  return LOOK(p);\n}",
    look: "use(PART, j)",
  },
  "through-a-return": { outside: "function get(): Part {\n  return PART;\n}", look: "LOOK(get())" },
  "through-a-meeting-of-two-ways": { look: "LOOK((j & 1 ? PART : spare))" },
  "through-a-closure": { look: "(() => LOOK(PART))()" },
  "through-a-pattern": {
    outside: "function taken(j: number): number {\n  const { held } = holder;\n  return LOOK(held);\n}",
    look: "taken(j)",
    holds: true,
  },
  "through-a-getter": {
    outside: "const door = {\n  get now(): Part {\n    return PART;\n  },\n};",
    look: "LOOK(door.now)",
  },
};
const helpers = ["some(Boolean)", "every(Boolean)", "find(Boolean)"];

function programOfIterators(partName: string, stepName: string, helper: string, declaration: string): string {
  const part = parts[partName];
  const step = steps[stepName];
  const look = (text: string) =>
    text
      .replace(/LOOK\(((?:[^()]|\([^()]*\))*)\)/g, (_, p) => `(${part.look.replace(/\bp\b/g, p)})`)
      .replaceAll("PART", "part");
  const make = (i: string) => part.make.replace(/\bi\b/g, i);
  const sentence =
    `${helper.replace(/\(.*/, "")} of the iterators walks a list ahead of the ${declaration} that holds ${partName}`.replaceAll(
      "-",
      " ",
    );
  return `// ${sentence[0].toUpperCase()}${sentence.slice(1)}. An iterator of the program, made below the declaration, has the same members, and its next() looks at the value ${stepName.replaceAll("-", " ")}.
type Part = ${part.type};
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
console.log([1, 2].values().${helper});
${part.declarations ? part.declarations + "\n" : ""}const seed = process.argv.length;
const spare: Part = ${make("seed + 40")};
${declaration} ${step.holds ? "holder" : "part: Part"} = ${step.holds ? `{ held: ${make("seed")} }` : make("seed")};
let total = 0;
${step.outside ? look(step.outside) + "\n" : ""}function made(): any {
  let j = 0;
  return {
    [Symbol.iterator](): any {
      return this;
    },
    next(): any {
      total = mix(total, ${look(step.look)});
      return { done: j >= 3, value: j++ };
    },
    return(): any {
      return {};
    },
  };
}
for (const each of made()) total = mix(total, each);
console.log(total, spare === undefined);
`;
}

function files() {
  const written: Record<string, string> = { ...shapedForOneWayToMove };
  const partNames = Object.keys(parts);
  const sourceNames = Object.keys(sources);
  let turn = 0;
  // Every kind of value on every road; the makers take turns.
  for (const roadName in roads)
    for (const partName of partNames) {
      const sourceName = sourceNames[turn++ % sourceNames.length];
      written[`${partName}-of-some-records-of-${sourceName}-${roadName}.ts`] = programOfRecords(
        partName,
        sourceName,
        roadName,
      );
    }
  // Every road out of every kind of variable, in the module and in a function; the kinds of value take turns.
  for (const readerName in readers)
    for (const declaration of declarations)
      for (const isInFunction of [false, true])
        for (let pick = 0; pick < 3; pick++) {
          const partName = partNames[turn++ % partNames.length];
          written[
            `${partName}-in-a-${declaration}-of-${isInFunction ? "a-function" : "the-module"}-read-${readerName}-ahead-of-its-store.ts`
          ] = programOfVariables(partName, readerName, declaration, isInFunction);
        }
  // Every kind of value on every road out of next(); the helpers and the kinds of variable take turns.
  for (const stepName in steps)
    for (const partName of partNames) {
      const helper = helpers[turn % helpers.length];
      const declaration = declarations[turn++ % 2];
      written[
        `${partName}-in-a-${declaration}-below-a-walk-by-${helper.replace(/\(.*/, "")}-read-${stepName}-by-an-iterator.ts`
      ] = programOfIterators(partName, stepName, helper, declaration);
    }
  return written;
}

export const programs = () => programsOf(files());
