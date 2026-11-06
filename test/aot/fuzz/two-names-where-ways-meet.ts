// Two names for one object. On a way that is seldom taken one of them is given another object. The ways meet, and behind a call, a stop or nothing both names are asked: each still names its own object.
//
//   arrives   made there, caught, sent into a generator, awaited, out of a list, a Map, a holder, a callback, a reviver: few of these can be followed, so what the object is has to be tested
//   function  plain, method, closure, generator run by hand, by `for-of` or spread, async function, async generator
//   first     the name that is given another object: a variable, one that a closure reads, one that a closure stores to, a variable of the module
//   second    a constant, a variable, a variable that a closure holds, a variable of the module, a field, an element
//   parts     a handler that a callee throws into, one that `throw()` enters, a `finally` that `return()` runs, a handler inside a handler, an arm that ends most calls, an arm of a switch, a turn of a loop, `??`
//   between   a call, a stop, a call and a stop, nothing
//   asked     identity in five spellings, a store of one into the other, one handed to a method of the other, both put into a new object or list, a store through one read through the other, fields that differ
//
// Every function runs some dozen times, and the seldom way is taken in some of them.
import type { Random } from "./random";

const prelude = `class Point {
  x: number;
  y: number;
  link: unknown = null;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  is(other: unknown): boolean {
    return this === other;
  }
  sum(other: Point): number {
    return this.x * 100 + other.x;
  }
}
class Other {
  x: number;
  y: number;
  link: unknown = null;
  tag = "other";
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  is(other: unknown): boolean {
    return this === other;
  }
  sum(other: Flat): number {
    return this.x * 1000 + other.x;
  }
}
type Flat = Point | Other;
class Pair {
  constructor(
    public a: Flat,
    public b: Flat,
  ) {}
}
const given: number[] = JSON.parse("[0.5, 1, 2, 3]");
let outside: Flat = new Point(-1, -1);
function show(o: unknown): string {
  if (o === null || typeof o !== "object") return String(o);
  return o.constructor.name;
}
function fail(when: boolean): void {
  if (when) throw new Error("no");
}
function caught(o: Flat): Flat {
  try {
    throw o;
  } catch (error) {
    return error as Flat;
  }
}
function* echo(): Generator<unknown, void, Flat> {
  for (let sent: Flat = yield; ; sent = yield sent);
}
const echoes = echo();
echoes.next();
function sent(o: Flat): Flat {
  return echoes.next(o).value as Flat;
}
const table = new Map<number, Flat>();
function mapped(o: Flat): Flat {
  table.set(o.x, o);
  return table.get(o.x)!;
}
function revived(o: Flat): Flat {
  return JSON.parse("[0]", (key, value) => (key === "0" ? o : value))[0];
}
function sorted(o: Flat): Flat {
  return [o, o].sort(() => 0)[given[1]];
}
function called(o: Flat): Flat {
  let got = o;
  [o].forEach(each => void (got = each));
  return got;
}`;

const arrivals = [
  "MADE",
  "MADE",
  "caught(MADE)",
  "sent(MADE)",
  "mapped(MADE)",
  "revived(MADE)",
  "sorted(MADE)",
  "called(MADE)",
  "[MADE][given[1] - 1]",
  "{ held: MADE }.held",
];
const made = ["new Point(N, N)", "new Point(N, N)", "new Point(N, N)", "new Other(N, N)"];
const numbers = ["p", "p + 1", "given[0]", "given[2]", "7", "p * 2", "0"];
const others = [
  "new Point(A.x + 1, A.y)",
  "new Point(A.x + 1, A.y)",
  "new Other(A.x + 1, A.y)",
  "caught(new Point(A.x + 1, 4))",
  "sent(new Other(A.x + 1, 4))",
  "outside",
  "Object.assign(new Point(0, 0), A, { x: A.x + 1 })",
  "Object.create(A) as Flat",
];
const touches = ["A.y;", "B.y;", "out += A.y;", "out += B.x;", "A.y += 1;", "void B.link;"];
const inside = ["const { x } = B;\n  out += x;", "const { x } = B;", "out += B.x;", "out += A.x;", "B.y += 1;", "", ""];
const asked = [
  'out += " " + (A === B);',
  'out += " " + (A === B);',
  'out += " " + (B === A);',
  'out += " " + (A !== B);',
  'out += " " + (A == B);',
  'out += " " + Object.is(A, B);',
  'out += A === B ? " same" : " apart";',
  'if (A !== B) out += " apart";',
  'A.link = B;\n  out += " " + (A.link === A) + (A.link === B);',
  'B.link = A;\n  out += " " + (B.link === A) + (B.link === B);',
  'out += " " + A.is(B) + B.is(A);',
  'out += " " + A.sum(B as Point) + "," + B.sum(A as Point);',
  '{\n    const pair = new Pair(A, B);\n    out += " " + (pair.a === pair.b) + pair.a.x + "," + pair.b.x;\n  }',
  '{\n    const both = { a: A.x, b: B, c: A };\n    out += " " + (both.b === both.c) + both.b.x;\n  }',
  '{\n    const row = [A.x, B, A];\n    out += " " + (row[1] === row[2]) + row.indexOf(B) + row.lastIndexOf(A);\n  }',
  'A.x = 50;\n  out += " " + B.x;',
  'B.x = 60;\n  out += " " + A.x;',
  'out += " " + A.x + "," + B.x + "," + A.y + "," + B.y;',
  'out += " " + show(A) + show(B);',
  'out += " " + (A instanceof Point) + (B instanceof Point) + ("tag" in A) + ("tag" in B);',
  'outside = B;\n  out += " " + (outside === A);',
  'out += " " + new Set([A, B]).size;',
];

type Form = "function" | "method" | "closure" | "generator" | "walked" | "spread" | "async" | "asyncGenerator";

export function generate(random: Random): string {
  const text = [prelude];
  const runs: string[] = [];
  const notes: string[] = [];
  const count = random.between(6, 10);
  for (let id = 1; id <= count; id++) {
    const form: Form = random.weighted([
      [4, "function"],
      [1, "method"],
      [1, "closure"],
      [5, "generator"],
      [1, "walked"],
      [1, "spread"],
      [3, "async"],
      [2, "asyncGenerator"],
    ] as const);
    const yields = form === "generator" || form === "walked" || form === "spread" || form === "asyncGenerator";
    const awaits = form === "async" || form === "asyncGenerator";
    const isDrivenByHand = form === "generator" || form === "asyncGenerator";
    const stop = () => (yields && (!awaits || random.chance(0.5)) ? "yield p;" : awaits ? "await null;" : "");
    const first = random.weighted([
      [6, "variable"],
      [2, "read"],
      [2, "stored"],
      [2, "module"],
    ] as const);
    const a = first === "module" ? `live${id}` : "o1";
    const second = random.weighted([
      [5, "constant"],
      [2, "variable"],
      [2, "captured"],
      [1, "module"],
      [1, "field"],
      [1, "element"],
    ] as const);
    const b = {
      constant: "o2",
      variable: "o2",
      captured: "o2",
      module: `kept${id}`,
      field: "holder.o",
      element: "list[0]",
    }[second];
    const number = () => random.pick(numbers);
    const written = (template: string) =>
      template
        .replace(/MADE/g, () => random.pick(made))
        .replace(/\bN\b/g, number)
        .replace(/\bA\b/g, a)
        .replace(/\bB\b/g, b);
    const rarely = random.pick(["p % 3 === 0", "p % 4 === 1", "p === 5", "true", "given[0] > p"]);
    const store = written(first === "stored" ? `put(${random.pick(others)});` : `A = ${random.pick(others)};`);
    const touch = () => written(random.pick(touches));
    const parts = random.weighted([
      [
        6,
        () =>
          `try {\n    ${random.chance(0.5) ? stop() : ""}\n    ${yields && random.chance(0.5) ? `yield fail(${rarely});` : awaits && random.chance(0.5) ? `await fail(${rarely});` : `fail(${rarely});`}\n    ${touch()}\n  } catch {\n    ${store}\n  }`,
      ],
      [isDrivenByHand ? 4 : 0, () => `try {\n    yield "throw";\n    ${touch()}\n  } catch {\n    ${store}\n  }`],
      [
        isDrivenByHand ? 2 : 0,
        () =>
          `try {\n    yield "return";\n    ${touch()}\n  } finally {\n    ${store}\n    ${written(random.pick(asked))}\n    seen.push(out);\n  }`,
      ],
      [
        3,
        () =>
          `try {\n    try {\n      fail(${rarely});\n      ${touch()}\n    } catch {\n      ${random.chance(0.5) ? stop() : ""}\n      fail(p % 2 === 0);\n      ${touch()}\n    }\n  } catch {\n    ${store}\n  }`,
      ],
      [
        2,
        () =>
          `try {\n    fail(${rarely});\n    ${touch()}\n  } catch {\n    ${store}\n  } finally {\n    ${touch()}\n  }`,
      ],
      [2, () => `if (${rarely}) {\n    ${store}\n  } else {\n    ${touch()}\n  }`],
      [
        1,
        () =>
          `switch (p & 3) {\n    case 3:\n      ${store}\n      break;\n    case 1:\n      ${touch()}\n    default:\n      ${touch()}\n  }`,
      ],
      [
        2,
        () =>
          `for (let i = 0; i < 3; i++) {\n    ${touch()}\n    try {\n      fail(i === 1 && ${rarely});\n    } catch {\n      ${store}\n    }\n  }`,
      ],
      [1, () => written(`A = (${rarely} ? null : A.y === A.y ? A : null) ?? ${random.pick(others)};`)],
    ] as const)();
    const between = random.weighted([
      [5, () => written("out += show(A);")],
      [2, stop],
      [2, () => `${written("out += show(A);")}\n  ${stop()}`],
      [1, () => ""],
    ] as const)();
    const declared = {
      constant: `const o2 = ${a};`,
      variable: `let o2 = ${a};`,
      captured: `let o2 = ${a};\n  const again = () => o2;`,
      module: `kept${id} = ${a};`,
      field: `const holder = { o: ${a} };`,
      element: `const list = [${a}];`,
    }[second];
    const begun = {
      variable: "let o1: Flat = ",
      read: "const now = () => o1;\n  let o1: Flat = ",
      stored: "const put = (o: Flat) => void (o1 = o);\n  let o1: Flat = ",
      module: `live${id} = `,
    }[first];
    const body = `let out = "";
  ${begun}${written(random.pick(arrivals))};
  ${declared}
  ${parts}
  ${written(random.pick(inside))}
  ${between}
  ${Array.from({ length: random.between(1, 3) }, () => written(random.pick(asked))).join("\n  ")}${second === "captured" ? `\n  out += " " + (again() === ${a});` : ""}${first === "read" ? `\n  out += " " + (now() === ${b});` : ""}
  ${form === "walked" || form === "spread" ? "yield out;\n  " : ""}return out;`;
    if (first === "module") text.push(`let live${id}: Flat = outside;`);
    if (second === "module") text.push(`let kept${id}: Flat = outside;`);
    notes.push(`${form}-${first}-${second}`);
    const name = `run${id}`;
    if (form === "function") text.push(`function ${name}(p: number): string {\n  ${body}\n}`);
    else if (form === "method")
      text.push(
        `class Home${id} {\n  run(p: number): string {\n  ${body}\n  }\n}\nconst ${name} = (p: number) => new Home${id}().run(p);`,
      );
    else if (form === "closure")
      text.push(
        `const ${name} = ((base: number) => (p: number): string => {\n  p += base;\n  ${body}\n})(given[1] - 1);`,
      );
    else if (form === "async") text.push(`async function ${name}(p: number): Promise<string> {\n  ${body}\n}`);
    else if (form === "asyncGenerator")
      text.push(`async function* ${name}(p: number): AsyncGenerator<unknown, string, unknown> {\n  ${body}\n}`);
    else text.push(`function* ${name}(p: number): Generator<unknown, string, unknown> {\n  ${body}\n}`);
    const wait = awaits ? "await " : "";
    const once = isDrivenByHand
      ? `{
    const steps = ${name}(round);
    let result = ${wait}steps.next();
    for (let i = 0; i < 20 && !result.done; i++) result = result.value === "throw" && round % 3 ? ${wait}steps.throw(new Error("in")) : result.value === "return" && round % 2 ? ${wait}steps.return("left") : ${wait}steps.next();
    lines.push(String(result.value));
  }`
      : form === "walked"
        ? `{\n    let walked = "";\n    for (const step of ${name}(round)) walked += step;\n    lines.push(walked);\n  }`
        : form === "spread"
          ? `lines.push([...${name}(round)].join());`
          : `lines.push(${wait}${name}(round));`;
    runs.push(
      `{\n  const lines: string[] = [];\n  for (let round = 0; round < ${random.pick([12, 12, 40])}; round++) ${once}\n  console.log("${id}: " + lines.join(" | "));\n}`,
    );
  }
  return `// ${notes.join(" ")}\nconst seen: string[] = [];\n${text.join("\n")}\n${runs.join("\n")}\nconsole.log(seen.join(" | "));\nexport {};\n`;
}
