// `function* g(x) { if (x) yield x.a; yield 1; if (x) yield x.b; }`: the same test in front of a yield and behind it. A compiler that
// keeps a generator's values in a frame on the heap has to carry what a test proved across the suspension, or ask again. Each scene
// varies the test (truthiness, typeof, instanceof, Array.isArray, undefined, null, a tag, `in`), where it stands (twice, kept in a
// constant, one branch that spans a yield, in loops, under try and finally, an early return, a conditional expression), whether what
// it asked about is still so behind the yield (the variable takes what next() sends, the caller changes the object or a shared
// variable between two steps) and how the generator is driven: spread, stepped by hand, left early, or thrown into.
import type { Random } from "./random";

interface Test {
  test: string;
  /** Expressions that are only right where the test holds. */
  uses: string[];
  /** A declared type of x, and values of that type. */
  type: string;
  values: string[];
}

const tests: Test[] = [
  {
    test: "x",
    uses: ["x.a", "x.b", "x.a + x.b"],
    type: "{ a: number; b: number } | null | undefined",
    values: ["{ a: 1, b: 2 }", "null", "undefined", "{ a: 0, b: 0.5 }"],
  },
  {
    test: "x",
    uses: ["x.a", "x.b", "x.a + x.b"],
    type: "{ a: number; b: number } | null | undefined",
    values: ["{ a: 1, b: 2 }", "undefined"],
  },
  {
    test: 'typeof x === "string"',
    uses: ["x.length", "x.toUpperCase()", 'x + "!"'],
    type: "string | number",
    values: ['"text"', "5", '""', "0.5"],
  },
  {
    test: 'typeof x === "number"',
    uses: ["x + 1", "x.toFixed(1)", "x * 2"],
    type: "string | number | undefined",
    values: ["5", '"text"', "undefined", "0.5", "NaN"],
  },
  {
    test: 'typeof x === "function"',
    uses: ["x()", "x.length"],
    type: "(() => number) | number",
    values: ["() => 7", "3"],
  },
  {
    test: 'typeof x === "object"',
    uses: ['x === null ? "null" : Object.keys(x).length', "String(x === null)"],
    type: "{ a: number } | null | string",
    values: ["{ a: 1 }", "null", '"text"'],
  },
  {
    test: "x instanceof Point",
    uses: ["x.sum()", "x.a"],
    type: "Point | { a: number }",
    values: ["new Point(1, 2)", "{ a: 3 }", "new Below(3, 4)"],
  },
  {
    test: "Array.isArray(x)",
    uses: ["x.length", "x[0]", "x.join()"],
    type: "number[] | number",
    values: ["[1, 2]", "7", "[]"],
  },
  { test: "x === undefined", uses: ['"none"', "typeof x"], type: "number | undefined", values: ["undefined", "4"] },
  {
    test: "x !== undefined",
    uses: ["x + 1", "x.toFixed(1)"],
    type: "number | undefined",
    values: ["undefined", "4", "0"],
  },
  {
    test: "x != null",
    uses: ["x.a", "x.a + 1"],
    type: "{ a: number } | null | undefined",
    values: ["{ a: 1 }", "null", "undefined"],
  },
  { test: "x === null", uses: ['"null"', "String(x)"], type: "{ a: number } | null", values: ["{ a: 1 }", "null"] },
  {
    test: 'x.kind === "circle"',
    uses: ["x.radius", "x.radius * 2"],
    type: '{ kind: "circle"; radius: number } | { kind: "square"; side: number }',
    values: ['{ kind: "circle", radius: 2 }', '{ kind: "square", side: 3 }'],
  },
  {
    test: '"a" in x',
    uses: ["x.a", "x.a + 1"],
    type: "{ a: number } | { b: number }",
    values: ["{ a: 1 }", "{ b: 2 }"],
  },
  { test: "x > 2", uses: ["x - 2", "x * x"], type: "number", values: ["1", "3", "2.5", "NaN", "2147483647"] },
  { test: "x.length", uses: ["x[0]", "x.length"], type: "number[] | string", values: ["[]", "[4]", '""', '"ab"'] },
];

/** Every kind of value, for a parameter without a declared type. */
const pool = [
  "{ a: 1, b: 2 }",
  "{ a: 0, b: 0.5 }",
  "null",
  "undefined",
  "0",
  "5",
  "0.5",
  "NaN",
  '""',
  '"text"',
  "[]",
  "[1, 2]",
  "new Point(1, 2)",
  "new Below(3, 4)",
  "() => 7",
  "true",
  "false",
  '{ kind: "circle", radius: 2 }',
  '{ kind: "square", side: 3 }',
  "new Map([[1, 2]])",
];

/** Bodies. T is the test, U1 and U2 are uses. */
const steady = [
  "if (T) yield U1;\n  yield 1;\n  if (T) yield U2;",
  "if (T) yield U1;\n  yield 1;\n  if (T) yield U2;",
  "if (T) yield U1;\n  yield 1;\n  if (T) yield U2;",
  "const held = T;\n  if (held) yield U1;\n  yield 1;\n  if (held) yield U2;",
  "const held = T;\n  yield 0;\n  if (held) yield U1;\n  yield 1;\n  if (held) yield U2;",
  'if (T) {\n    yield U1;\n    yield U2;\n  } else {\n    yield "else";\n    yield typeof x;\n  }',
  "if (T) {\n    yield 0;\n    yield U1;\n    yield 1;\n    yield U2;\n  }",
  "for (let i = 0; i < 3; i++) {\n    if (T) yield U1;\n    yield i;\n    if (T) yield U2;\n  }",
  "for (let i = 0; i < 3; i++) {\n    if (!(T)) continue;\n    yield U1;\n    yield U2;\n  }",
  'try {\n    if (T) yield U1;\n    yield 1;\n    if (T) yield U2;\n  } catch (error) {\n    yield "caught";\n    if (T) yield U1;\n  } finally {\n    yield "finally";\n  }',
  "for (const each of [1, 2]) {\n    try {\n      if (T) yield U1;\n      yield each;\n    } finally {\n      if (T) yield U2;\n    }\n  }",
  'if (!(T)) return "early";\n  yield U1;\n  yield 1;\n  yield U2;',
  'yield T ? U1 : "no";\n  yield 1;\n  yield T ? U2 : "no";',
  "while (T) {\n    yield U1;\n    if (++count > 2) break;\n    yield U2;\n  }",
  "if (T) yield U1;\n  yield* inner();\n  if (T) yield U2;",
  "if (T) yield U1;\n  yield 1;\n  if (T) yield U2;\n  yield 2;\n  if (T) return U1;",
  "const first = T ? U1 : 0;\n  yield first;\n  if (T) yield [first, U2];",
];
/** Bodies in which x is another value behind the yield. Only without a declared type. */
const moving = [
  "if (T) yield U1;\n  x = yield 1;\n  if (T) yield U2;",
  "if (T) yield U1;\n  x = yield 1;\n  if (T) yield U2;",
  "for (let i = 0; i < 3; i++) {\n    if (T) yield U1;\n    x = yield i;\n    if (T) yield U2;\n  }",
  'try {\n    if (T) yield U1;\n    x = yield 1;\n    if (T) yield U2;\n  } catch (error) {\n    yield "caught";\n  }',
  "const held = T;\n  if (held) yield U1;\n  x = yield 1;\n  if (held) yield typeof x;\n  if (T) yield U2;",
  "if (T) {\n    yield U1;\n    x = yield 1;\n    yield typeof x;\n  }\n  if (T) yield U2;",
];

export function generate(random: Random, typed: boolean): string {
  const any = typed ? ": any" : "";
  const failure = typed ? "(error as Error).name" : "error.name";
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.35);
    const test = isPlain ? random.pick(tests.slice(0, 4)) : random.pick(tests);
    const isDeclared = typed && random.chance(0.5);
    const change = isDeclared || isPlain ? "none" : random.pick(["none", "none", "sent", "sent", "poked", "shared"]);
    const body =
      change === "sent" ? random.pick(moving) : isPlain ? random.pick(steady.slice(0, 5)) : random.pick(steady);
    const [first, second] = [random.pick(test.uses), random.pick(test.uses)];
    const name = change === "shared" ? `shared${scene}` : "x";
    const text = body
      .replaceAll("U1", `(${first})`)
      .replaceAll("U2", `(${second})`)
      .replaceAll("T", test.test)
      .replace(/\bx\b/g, name);
    const values = isDeclared ? test.values : [...test.values, ...random.sample(pool, random.between(2, 8))];
    const drive = isPlain
      ? random.pick(["spread", "by hand"])
      : change === "none"
        ? random.pick(["spread", "by hand", "by hand", "left early", "thrown into"])
        : "by hand";
    const sends = random.sample(pool, 3);
    const between =
      change === "sent"
        ? `sent = sends${scene}[(at + turn) % 3]${typed ? "!" : ""}();`
        : change === "poked"
          ? "if (at === 0) poke(value);"
          : change === "shared"
            ? `if (at === 0) shared${scene} = sends${scene}[turn % 3]${typed ? "!" : ""}();`
            : drive === "left early"
              ? 'if (at === 1) {\n        said.push("left " + shown(steps.return("out")));\n        break;\n      }'
              : drive === "thrown into"
                ? 'if (at === 1) {\n        step = steps.throw(new RangeError("in"));\n        continue;\n      }'
                : "";
    const turns = random.pick([2, 20, 200, 1500]);
    scenes.push(`${change === "shared" ? `let shared${scene}${any};\n` : ""}function* g${scene}(${change === "shared" ? "" : `x${isDeclared ? `: ${test.type}` : any}`})${typed ? ": Generator<any, any, any>" : ""} {
  let count = 0;
  ${text}
}
const values${scene}${typed ? `: (() => ${isDeclared ? test.type : "any"})[]` : ""} = [${values.map(value => `() => (${value})`).join(", ")}];
const sends${scene}${typed ? ": (() => any)[]" : ""} = [${sends.map(value => `() => (${value})`).join(", ")}];
function drive${scene}(value${any}, turn${typed ? ": number" : ""}) {
  const said${typed ? ": string[]" : ""} = [];
  try {
    ${change === "shared" ? `shared${scene} = value;` : ""}
    const steps = g${scene}(${change === "shared" ? "" : "value"});
    ${
      drive === "spread"
        ? "for (const each of [...steps]) said.push(shown(each));"
        : `let sent${any};
    let step = steps.next();
    for (let at = 0; !step.done && at < 14; at++) {
      said.push(shown(step.value));
      ${between}
      step = steps.next(sent);
    }
    said.push("returned " + shown(step.value));`
    }
  } catch (error) {
    said.push("threw " + ${failure});
  }
  return said.join();
}
{
  let hash = 0;
  let last = "";
  for (let turn = 0; turn < ${turns}; turn++) {
    last = values${scene}.map(make => drive${scene}(make(), turn)).join(" | ");
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `class Point {
  a${typed ? ": number" : ""};
  b${typed ? ": number" : ""};
  constructor(a${typed ? ": number" : ""}, b${typed ? ": number" : ""}) {
    this.a = a;
    this.b = b;
  }
  sum() {
    return this.a + this.b;
  }
}
class Below extends Point {}
function* inner() {
  yield "inner";
}
function shown(value${any})${typed ? ": string" : ""} {
  return typeof value === "function" ? "function" : (JSON.stringify(value) ?? String(value));
}
function poke(value${any}) {
  if (Array.isArray(value)) value.length = 0;
  else if (value !== null && typeof value === "object") {
    delete value.a;
    value.kind = "square";
  }
}
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
