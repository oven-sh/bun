// `function rest(size) { const made = new Set(..); const it = made.values(); it.next(); return it; }`, called from two places. A
// compiler that lets each caller build what a helper returns has to hand on all that the helper did to it first. Each scene varies
// what is made (lists, maps, sets, views, patterns, dates, generators, iterator helpers, bound functions, closures, arguments,
// promises, records), what changes before the return (steps of an iterator: none, some, all, on one branch only, by for-of with a
// break, by a pattern; stores, deletes and a clear behind the step; lastIndex, length, setTime, a new property, freeze), how it
// comes back (alone, beside its collection in a record or list, one of two on a branch) and the call sites: a written size and one
// the build cannot know, the answer used in place and handed to another function.
import type { Random } from "./random";

interface Kind {
  /** An expression of `size`, or statements that declare `made`. */
  makes: string[];
  /** Statements that change `made` before the helper returns. */
  changes: string[];
  /** Expressions that ask about `got`, which is `made` in the hands of a caller. */
  asks: string[];
  /** Calls that take an iterator of `made`. */
  iterators?: string[];
}

const fourIterators = ["made.values()", "made.keys()", "made.entries()", "made[Symbol.iterator]()"];
const stepsOfItself = [
  "made.next();",
  "made.next();\n  made.next();",
  "for (let step = 0; step < size; step++) made.next();",
  "if (turn % 3) made.next();",
  "if (size > 4) made.next();",
  "while (!made.next().done);",
  "for (const each of made) break;",
  "const [first] = made;\n  said.push(shown(first));",
  "made.return(7);",
  "made.extra = size;",
];
const asksOfAnIterator = [
  "shown(got.next())",
  "shown(got.next().value)",
  "shown([...got])",
  "walked(got)",
  "got.extra",
];

const kinds: Kind[] = [
  {
    makes: [
      "Array.from({ length: size }, (_, at) => at * 10)",
      "[size, size + 1, size + 2, size + 3]",
      "new Array(size).fill(7)",
      "objects.slice(0, size)",
      "Object.keys(record(size))",
      "Object.entries(record(size))",
      "Object.values(record(size))",
      "const made$A = [];\n  for (let at = 0; at < size; at++) made.push(at * 3);",
    ],
    changes: [
      "made.push(99);",
      "made.pop();",
      "made.shift();",
      "made.length = 1;",
      "made.length = size + 2;",
      'made[0] = "changed";',
      "made.reverse();",
      "delete made[1];",
      "made.extra = size;",
      "Object.freeze(made);",
    ],
    asks: [
      "shown(got)",
      "got.length",
      "got.extra",
      "Object.isFrozen(got)",
      "Object.keys(got).join()",
      "shown(got.at(-1))",
    ],
    iterators: fourIterators,
  },
  {
    makes: [
      "new Map(pairs(size))",
      "new Map(pairsOfObjects(size))",
      'new Map$G([["a", size], ["b", 2], ["c", 3]])',
      "const made$A = new Map();\n  for (let at = 0; at < size; at++) made.set(at, at * 2);",
      'const made$A = new Map();\n  for (let at = 0; at < size; at++) made.set("k" + at, at);',
      "const made$A = new Map();\n  for (let at = 0; at < size; at++) made.set(objects[at], at);",
    ],
    changes: [
      "made.set(99, 1);",
      'made.set(0, "again");',
      "made.delete(0);",
      "made.delete(1);",
      "made.delete(objects[0]);",
      'made.delete("a");',
      'made.delete(1);\n  made.set(1, "back");',
      "made.clear();",
      "made.clear();\n  made.set(5, 5);",
      "made.extra = size;",
    ],
    asks: ["shown([...got])", "got.size", "got.extra", "shown(got.get(1))", "got.has(0)", "got.has(objects[1])"],
    iterators: fourIterators,
  },
  {
    makes: [
      "new Set(listOf(size))",
      "new Set(objects.slice(0, size))",
      'new Set$H(["a", "b", size])',
      "const made$A = new Set();\n  for (let at = 0; at < size; at++) made.add(at);",
      "const made$A = new Set();\n  for (let at = 0; at < size; at++) made.add(objects[at]);",
    ],
    changes: [
      "made.add(99);",
      "made.add(0);",
      "made.delete(0);",
      "made.delete(1);",
      "made.delete(objects[0]);",
      "made.delete(1);\n  made.add(1);",
      "made.clear();",
      "made.clear();\n  made.add(5);",
      "made.extra = size;",
    ],
    asks: ["shown([...got])", "got.size", "got.extra", "got.has(0)", "got.has(objects[1])"],
    iterators: fourIterators,
  },
  {
    makes: [
      "new Uint8Array(size + 2).subarray(1)",
      "new Int32Array(size).fill(3)",
      "Uint8Array.from({ length: size }, (_, at) => at)",
      "new Float64Array([size, 0.5, 1.5]).subarray(0, 2)",
    ],
    changes: ["made[0] = 200;", "made.fill(9);", "made.reverse();", "made.set([5], 0);", "made.extra = size;"],
    asks: ["shown([...got])", "got.length", "got.byteOffset", "got.buffer.byteLength", "got.extra"],
    iterators: ["made.values()", "made.keys()", "made.entries()"],
  },
  {
    makes: ["/a\\d/g", 'new RegExp("a\\\\d", "g")', "/a(\\d)/y"],
    changes: [
      'made.exec("a1a2a3");',
      'made.exec("a1a2a3");\n  made.exec("a1a2a3");',
      'made.test("a1a2a3");',
      'if (turn % 3) made.test("a1a2a3");',
      "made.lastIndex = size;",
      "made.extra = size;",
      "Object.freeze(made);",
    ],
    asks: [
      "got.lastIndex",
      'shown(got.exec("a1a2a3a4a5a6a7"))',
      "got.extra",
      "got.source + got.flags",
      "Object.isFrozen(got)",
    ],
  },
  {
    makes: ["new Date(86400000 * size)", "new Date(Date.UTC(2001, 0, size + 1))"],
    changes: [
      "made.setTime(5);",
      "made.setUTCFullYear(1999);",
      "made.setTime(NaN);",
      "if (turn % 3) made.setTime(size);",
      "made.extra = size;",
      "Object.freeze(made);",
    ],
    asks: ["got.getTime()", "got.toISOString()", "got.extra", "shown(got)"],
  },
  {
    makes: ["counts(size)", "(function* () {\n    yield size;\n    yield size + 1;\n    return 9;\n  })()"],
    changes: stepsOfItself,
    asks: [...asksOfAnIterator, "shown(got.return(1))"],
  },
  {
    makes: [
      "listOf(size).values().map((each$A) => each * 2)",
      "listOf(size).values().filter((each$A) => each % 2)",
      "listOf(size).values().drop(1)",
      "listOf(size).values().take(2)",
      "new Set(listOf(size)).values().map((each$A) => each + 1)",
      "Iterator.from(counts(size))",
    ],
    changes: stepsOfItself,
    asks: asksOfAnIterator,
  },
  {
    makes: ["add.bind(null, size)", "add.bind({ base: size })", "add.bind({ base: 1 }, size, 2)"],
    changes: [
      "made.extra = size;",
      'Object.defineProperty(made, "name", { value: "renamed" });',
      "Object.freeze(made);",
    ],
    asks: ["got(1, 2)", "got.extra", "got.name", "got.length", "typeof got"],
  },
  {
    makes: ["() => size", "const made$A = (() => {\n    let count = size;\n    return () => ++count;\n  })();"],
    changes: ["made();", "made();\n  made();", "if (turn % 3) made();", "made.extra = size;", "Object.freeze(made);"],
    asks: ["got()", "got() + got()", "got.extra", "got.length"],
  },
  {
    makes: ["(function (...rest$R) {\n    return arguments;\n  })(size, size + 1, size + 2)"],
    changes: [
      'made[0] = "changed";',
      "made.length = 1;",
      "delete made[1];",
      "made.extra = size;",
      "Object.freeze(made);",
    ],
    asks: [
      "shown(Array.from(got))",
      "got.length",
      "got.extra",
      "Object.prototype.toString.call(got)",
      "shown([...got])",
    ],
    iterators: ["made[Symbol.iterator]()"],
  },
  {
    makes: ["Promise.resolve(size)", "new Promise(resolve => resolve(size))"],
    changes: ["made.extra = size;", "made.then(() => {});", "Object.freeze(made);"],
    asks: ["got.extra", "got instanceof Promise", "Object.isFrozen(got)", "typeof got.then"],
  },
  {
    makes: ["{ a: size, b: 2 }", "{ a: size, 0: size }", "Object.create(above)", "new Point(size)"],
    changes: [
      "made.c = 3;",
      "delete made.a;",
      'made.a = "changed";',
      "made[1] = size;",
      "Object.freeze(made);",
      "if (turn % 3) made.c = turn % 2;",
    ],
    asks: ["shown(got)", "Object.keys(got).join()", "got.a", "got.c", "Object.isFrozen(got)", "got.base"],
  },
];

const steps = [
  "",
  "it.next();",
  "it.next();",
  "it.next();\n  it.next();",
  "for (let step = 0; step < STEPS; step++) it.next();",
  "for (let step = 0; step < size; step++) it.next();",
  "for (let step = 0; step < size - 1; step++) it.next();",
  "if (turn % 3) it.next();",
  "if (size > 4) it.next();",
  'if (size > 4) it.next();\n  else said.push("short");',
  "while (!it.next().done);",
  "for (const each of it) break;",
  "for (const each of it) {\n    if (++seen > 1) break;\n  }",
  "const [first] = it;\n  said.push(shown(first));",
  "const [, second] = it;\n  said.push(shown(second));",
  "if (turn % 2) said.push(shown([...it]));",
  "said.push(shown(it.next().value));",
];

/** What the helper returns, and how a caller takes it apart. */
const answers: [string, string][] = [
  ["it", "const it$A = answer;"],
  ["it", "const it$A = answer;"],
  ["it", "const it$A = answer;"],
  ["{ it, made }", "const { it, made: got } = answer;"],
  ["[it, made]", "const [it, got] = answer;"],
  ["turn % 2 ? it : OTHER", "const it$A = answer;"],
  ["size > 4 ? it : OTHER", "const it$A = answer;"],
];

const asksOfIt = [
  "said.push(told(() => shown(it.next().value)));",
  "said.push(told(() => shown(it.next().value)));",
  "said.push(told(() => shown(it.next())));",
  "said.push(told(() => shown([...it])));",
  "said.push(told(() => shown([...it])));",
  "said.push(told(() => walked(it)));",
  "said.push(told(() => walked(it)));",
  "if (turn % 2) said.push(told(() => shown([...it])));\n  said.push(told(() => walked(it)));",
  "said.push(told(() => shown(it.next().value)), told(() => shown([...it])));",
  "said.push(told(() => shown(Array.from(it))));",
  "for (const each of it) said.push(shown(each));",
];

export function generate(random: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const number = typed ? ": number" : "";
  const list = typed ? ": string[]" : "";
  const fill = (code: string) =>
    code
      .replaceAll("$A", any)
      .replaceAll("$R", typed ? ": any[]" : "")
      .replaceAll("$G", typed ? "<any, any>" : "")
      .replaceAll("$H", typed ? "<any>" : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const isPlain = random.chance(0.35);
    const kind = isPlain || random.chance(0.5) ? random.pick(kinds.slice(0, 3)) : random.pick(kinds);
    const make = fill(random.pick(kind.makes));
    const walks = kind.iterators !== undefined && (isPlain || random.chance(0.75));
    const call = walks ? random.pick(kind.iterators!) : "";
    const step = walks
      ? (isPlain ? random.pick(steps.slice(1, 6)) : random.pick(steps)).replace("STEPS", String(random.between(0, 4)))
      : "";
    const change = (walks ? !isPlain && random.chance(0.5) : true) ? random.pick(kind.changes) : "";
    const isChangedFirst = walks && random.chance(0.2);
    const [answer, take] = walks ? (isPlain ? answers[0]! : random.pick(answers)) : ["made", "const got$A = answer;"];
    const asked = [
      ...(walks ? [random.pick(asksOfIt)] : []),
      ...(take.includes("got")
        ? random.sample(kind.asks, random.between(1, 3)).map(ask => `said.push(told(() => ${ask}));`)
        : []),
    ].join("\n  ");
    const written = random.pick([0, 1, 2, 3, 3, 5, 9]);
    const unknown = `process.argv.length + ${random.pick([0, 1, 3, 3, 7])}`;
    const sites = isPlain
      ? "two"
      : random.pick(["two", "two", "two", "written alone", "unknown alone", "two in place"]);
    const inPlace = (size: string) => `{
    const answer${any} = make${scene}(${size}, turn, said);
    ${fill(take)}
    ${asked}
  }`;
    const handedOn = (size: string) => `look${scene}(make${scene}(${size}, turn, said), turn, said);`;
    const turns = random.pick([3, 30, 300, 2500]);
    scenes.push(`function make${scene}(size${number}, turn${number}, said${list})${any} {
  let seen = 0;
  ${make.startsWith("const made") ? make : `const made${any} = ${make};`}
  ${isChangedFirst ? change : ""}
  ${walks ? `const it${any} = ${call};` : ""}
  ${step}
  ${isChangedFirst ? "" : change}
  return ${answer.replace("OTHER", call)};
}
function look${scene}(answer${any}, turn${number}, said${list}) {
  ${fill(take)}
  ${asked}
}
function run${scene}(turn${number}) {
  const said${list} = [];
  ${sites === "unknown alone" ? "" : inPlace(String(written))}
  ${sites === "written alone" ? "" : sites === "two in place" ? inPlace(unknown) : handedOn(unknown)}
  return said.join(" ");
}
{
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    try {
      last = run${scene}(turn);
    } catch (error) {
      last = "threw " + ${typed ? "(error as Error).name" : "error.name"};
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `const objects = Array.from({ length: 16 }, (_, id) => ({ id }));
const above = { base: 1 };
class Point {
  a${any};
  constructor(a${any}) {
    this.a = a;
  }
}
function shown(value${any})${typed ? ": string" : ""} {
  return JSON.stringify(value) ?? "undefined";
}
function told(ask${typed ? ": () => unknown" : ""}) {
  try {
    return String(ask());
  } catch (error) {
    return "threw " + ${typed ? "(error as Error).name" : "error.name"};
  }
}
function walked(it${any}) {
  const values = [];
  for (let step = it.next(); !step.done; step = it.next()) values.push(shown(step.value));
  return values.join("|");
}
function listOf(size${number})${any} {
  return Array.from({ length: size }, (_, at) => at);
}
function pairs(size${number})${any} {
  return Array.from({ length: size }, (_, at) => [at, at * 2]);
}
function pairsOfObjects(size${number})${any} {
  return objects.slice(0, size).map((each, at) => [each, at]);
}
function record(size${number}) {
  const made${typed ? ": Record<string, number>" : ""} = {};
  for (let at = 0; at < size; at++) made["k" + at] = at;
  return made;
}
function* counts(limit${number}) {
  for (let at = 0; at < limit; at++) yield at * 3;
}
function add(${typed ? "this: any, " : ""}a${any}, b${any} = 0, c${any} = 0) {
  return (this?.base ?? 0) + a + b + c;
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
