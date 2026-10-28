// Small functions that make a few small objects out of their own variables, go on changing them, and read their fields right there. Most of these objects never need to exist; some are seen by somebody else late, on one path alone: then they must be whole, be one object and not two, and hold what was stored last.
//
//   objects   literals, instances, instances of a subclass, results of small functions, copies, an object inside an object, a list inside an object, a chain of links, a pair in a list
//   names     one name for one object, two names for one object, one name for one of two objects, names that are swapped, a name that a loop carries from one object to the next
//   changes   stores of whole numbers, then fractions, `+=`, `++`, a field from another field, a swap of two fields, another inner object, a function that changes its parameter
//   seen      never; pushed to a list outside, stored in a variable outside, captured by a closure, put into another object, handed to JSON: always, in one arm, in a handler, behind a stop, in the last turn of a loop
//   flow      straight on, arms, loops with `continue` and `break`, a throw between two stores with the reads in the handler, a finally, a closure called there, a generator run by hand, spread, or left in the middle of a `for-of`, an async function
//   reads     fields, sums of fields, identity, the names of the fields in their order, patterns, methods, `instanceof`
//
// What was seen outside is printed at the end.
import type { Random } from "./random";

const prelude = `type Flat = { x: number; y: number };
type Nest = { inner: Flat; tag: string; list: number[] };
type Link = { v: number; next: Link | null };
function num(x: number): string {
  return Object.is(x, -0) ? "-0" : String(x);
}
function show(o: unknown): string {
  if (typeof o === "number") return num(o);
  if (o === null || typeof o !== "object") return String(o);
  if (Array.isArray(o)) return "[" + o.map(show).join() + "]";
  let all = o.constructor === Object ? "{" : o.constructor.name + "{";
  for (const key of Object.keys(o)) all += key + ":" + show((o as Record<string, unknown>)[key]) + ";";
  return all + "}";
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
  moved(by: number): Point {
    return new Point(this.x + by, this.y + by);
  }
  static of(x: number, y: number): Point {
    return new Point(x, y);
  }
}
class Point3 extends Point {
  z: number;
  constructor(x: number, y: number, z: number) {
    super(x, y);
    this.z = z;
  }
  sum(): number {
    return super.sum() + this.z;
  }
}
const kept: unknown[] = [];
let last: Flat | null = null;
const given: number[] = JSON.parse("[0, 1, 2, 3, 0.5]");
const loose: any = given;
function fail(when: boolean): void {
  if (when) throw new Error("stop");
}
function sumOf(o: Flat): number {
  return o.x + o.y;
}
function grow(o: Flat): void {
  o.x += 1;
  o.y *= 2;
}
function pick(a: Flat, b: Flat, first: boolean): Flat {
  return first ? a : b;
}
function make(x: number, y: number): Flat {
  return { x, y };
}
function turned(o: Flat): Flat {
  return { x: o.y, y: o.x };
}
function both(x: number): [Flat, Flat] {
  return [{ x, y: x + 1 }, new Point(x + 2, x + 3)];
}
function nest(x: number): Nest {
  return { inner: { x, y: x }, tag: "n", list: [x] };
}`;

const numbers = ["p", "q", "a", "a", "b", "a + 1", "a * 2", "a + b", "a - b", "0.5", "a / 2", "7", "0", "-0", "a | 0", "a * 65536", "O.x", "O.y", "P.x", "O.x + P.y", "given[1]", "given[4]", "B.inner.x", "B.list.length"];
const conditions = ["a > b", "p === 3", "a % 2 === 0", "O.x > P.x", "O === P", "given[0] < 1", "given[0] > 0", "turns > 2", "O.y !== O.y", "B.list.length > 1"];
const rare = ["given[0] > 0", "given[0] < 1", "a === 12345", "turns === 2", "O.x === 0.5", "p > q"];
const flats = ["{ x: N, y: N }", "{ x: N, y: N }", "{ x: N, y: N }", "new Point(N, N)", "new Point(N, N)", "new Point3(N, N, N)", "make(N, N)", "Point.of(N, N)", "{ ...O }", "{ ...O, y: N }", "turned(O)", "new Point(N, N).moved(N)", "both(N)[0]", "both(N)[1]", "[{ x: N, y: N }][0]", "Object.assign({ x: 0, y: 0 }, { x: N })", "nest(N).inner", "MADE(N, N)", "MADE(N, N)"];
// Another name for an object that is there already.
const again = ["O", "P", "C ? O : P", "pick(O, P, C)", "B.inner", "[O, P][a & 1]", "(() => O)()"];
const nests = ["{ inner: { x: N, y: N }, tag: \"t\", list: [N] }", "{ inner: { x: N, y: N }, tag: \"t\", list: [N] }", "{ inner: new Point(N, N), tag: \"t\", list: [] }", "{ inner: O, tag: \"t\", list: [N, N] }", "nest(N)"];

const stores = ["O.x = N;", "O.x = N;", "O.y = N;", "O.x += N;", "O.x++;", "O.y--;", "O.y *= 2;", "O.x /= 2;", "O.x = O.y;", "O.x = P.y;", "[O.x, O.y] = [O.y, O.x];", "[O.x, P.x] = [P.x, O.x];", "O.x = P.x + O.y;", "({ x: O.x, y: O.y } = P);", "grow(O);", "grow(pick(O, P, C));", "B.inner.x = N;", "B.inner.y += N;", "B.inner = { x: N, y: N };", "B.inner = O;", "B.inner = turned(B.inner);", "B.list.push(N);", "B.list[0] = N;", "B.list = [N, N];", 'B.tag += "g";', "grow(B.inner);", "O.x = B.inner.x;", "Object.assign(O, { y: N });", "Object.assign(O, P);", "O.x = L[a & 1];", "O.y += L[1];", "B.inner.x = L[2];", "B.list.push(L[0]);"];
// Only where the name may be given another object.
const renames = ["O = P;", "O = { x: O.y, y: O.x };", "O = make(O.x, P.y);", "O = pick(O, P, C);", "[O, P] = [P, O];", "O = C ? O : P;", "O = turned(O);", "O = B.inner;", "O = { ...O, x: N };", "O = new Point(O.x, O.y);", "O = MADE(O.x, N);"];
const reads = ['out += num(O.x) + "," + num(O.y) + " ";', 'out += num(O.x) + "," + num(O.y) + " ";', 'out += num(O.x + P.y) + " ";', '{\n    const { x, y } = O;\n    out += num(x) + "," + num(y) + " ";\n  }', 'out += (O === P) + " ";', 'out += (O === P) + "," + (B.inner === O) + "," + (B.inner === P) + " ";', 'out += Object.keys(O).join() + " ";', 'out += JSON.stringify(O) + " ";', 'out += num(sumOf(O)) + " ";', 'out += (O instanceof Point) + "," + (O instanceof Point3) + " ";', 'out += show(O) + " ";', 'for (const key in O) out += key;\n  out += " ";', 'out += Object.values(O).join() + " ";', 'out += (O instanceof Point ? num(O.sum()) : "plain") + " ";', 'out += num(B.inner.x) + "," + num(B.inner.y) + "," + B.tag + "," + B.list.join("/") + " ";', 'out += show(B) + " ";', 'out += num(B.inner.x + O.x) + " ";', 'out += num(turned(O).x) + "," + num(turned(turned(O)).x) + " ";', 'out += num(Math.max(O.x, P.x)) + "," + num(O.x * P.y) + " ";', 'out += num({ x: O.x, y: P.y }.x) + " ";', 'out += num([O, P][a & 1].x) + " ";', 'out += num((C ? O : P).y) + " ";', 'out += (1.5).toFixed(L[1] & 3) + num(O.x) + " ";', 'out += String(L[a & 3]) + num(O.y) + " ";'];
const seen = ["kept.push(O);", "last = O;", "kept.push(B);", "kept.push(B.inner);", "kept.push([O, P]);", "kept.push({ held: O });", "kept.push(() => O.x);", "local.push(O);", "kept.push(B.list);", "kept.push(JSON.stringify(O));", "kept.push({ ...O });"];

export function generate(random: Random): string {
  const notes: string[] = [];
  const text: string[] = [prelude];
  const run: string[] = [];
  // Small functions whose result is an object that they have just made.
  const makers = random.between(1, 3);
  const functions = random.between(5, 10);
  for (let id = 1; id <= makers + functions; id++) {
    const isMaker = id <= makers;
    const form = isMaker ? "maker" : random.weighted([[6, "function"], [2, "generator"], [3, "spread"], [2, "left"], [2, "async"], [1, "method"]] as const);
    const isInside = form === "spread" || form === "left";
    const stops = form === "generator" || isInside ? "yield" : form === "async" ? "await" : "";
    const mayRename = random.chance(0.5);
    // Most functions are gentle with the object that holds others: nobody gets hold of what lies inside it, and nobody outside sees it. Each has a class of its own, so that a rough function spoils nothing for the others.
    const isGentle = random.chance(0.6);
    const hasHolder = !isMaker && random.chance(0.7);
    const usable = (templates: string[]) => (isGentle ? templates.filter(each => !/\bB\.inner\b(?!\.[xy]\b)|\bB\b(?!\.)|inner: O/.test(each)) : templates);
    const all = ["o1", "o1", "o2", "o2", "o3"];
    const flat = () => random.pick(all);
    // `names` are the objects that are there already. One letter is one object all through a template; what a number brings in is drawn anew.
    const written = (template: string, names: string[] = all, hasBox = true): string => {
      for (let depth = 0; depth < 4 && /\b[NCOPBL]\b|MADE/.test(template); depth++) {
        template = template
          .replace(/\bL\b/g, () => random.pick(["loose", "soft", "soft"]))
          .replace(/\bC\b/g, () => random.pick(conditions))
          .replace(/\bN\b/g, () => (depth < 2 ? random.pick(numbers) : random.pick(["a", "b", "p", "7"])))
          .replace(/MADE/g, () => (isMaker || makers === 0 ? "make" : `made${random.between(1, makers)}`));
        if (!hasBox) template = template.replace(/\bB(\.\w+)+/g, "a");
        if (!names.length) template = template.replace(/\bO === P\b/g, "a === b").replace(/\b[OP](\.\w+)+/g, "b");
        else template = template.replace(/\bO\b/g, random.pick(names)).replace(/\bP\b/g, random.pick(names));
        template = template.replace(/\bB\b/g, "box");
      }
      return template;
    };
    // Inside a closure nothing stops.
    let isInClosure = false;
    const stop = () => (isInClosure ? "a += 1;" : stops === "yield" ? (isInside ? 'yield "|";' : "yield a;") : stops === "await" ? "await null;" : "");
    const closed = (make: () => string): string => {
      isInClosure = true;
      const made = make();
      isInClosure = false;
      return made;
    };
    const simple = (): string =>
      random.weighted([
        [7, () => written(random.pick(usable(stores)))],
        [8, () => written(random.pick(usable(reads)))],
        [mayRename ? 3 : 0, () => written(random.pick(usable(renames)))],
        [2, () => random.pick(["a += 1;", "a += b;", "a *= 2;", "b += 0.5;", "a = a / 2;", "b = a;", "a = -a;"])],
        [1, () => written(random.pick(usable(seen)))],
        [2, () => `if (${written(random.pick(rare))}) ${written(random.pick(usable(seen)))}`],
        [stops ? 3 : 0, stop],
        [1, () => written(`{\n    const fresh: Flat = ${random.pick(flats)};\n    ${random.pick(usable(stores)).replace(/\bO\b/g, "fresh")}\n    ${random.pick(usable(reads)).replace(/\bO\b/g, "fresh")}\n  }`)],
        [1, () => written('{\n    const [l, r] = both(N);\n    l.x += r.y;\n    out += num(l.x) + "," + num(r.x) + "," + (l === r) + " ";\n  }')],
        [1, () => written('{\n    let head: Link | null = null;\n    for (let i = 0; i < 3; i++) head = { v: N + i, next: head };\n    let n = 0;\n    for (let c = head; c; c = c.next) n = n * 10 + c.v;\n    out += num(n) + " ";\n  }')],
      ] as const)();
    const block = (size: number) => Array.from({ length: size }, simple).join("\n  ");
    const nested = (): string =>
      random.weighted([
        [8, () => block(random.between(1, 3))],
        [4, () => `if (${written("C")}) {\n  ${block(random.between(1, 2))}\n  } else {\n  ${block(random.between(1, 2))}\n  }`],
        [4, () => `for (let i = 0; i < ${random.between(2, 4)} && turns++ < 8; i++) {\n  ${block(random.between(1, 3))}${random.chance(0.3) ? `\n  if (${written("C")}) ${random.pick(["continue", "break"])};\n  ${block(1)}` : ""}\n  }`],
        [mayRename ? 3 : 0, () => written(`for (let i = 0; i < 3 && turns++ < 8; i++) {\n  const next: Flat = ${random.pick(["{ x: O.x + i, y: O.y }", "new Point(O.y, O.x + 1)", "make(O.x * 2, i)", "turned(O)"])};\n  ${block(random.between(0, 2))}\n  `) + `${flat()} = next;\n  }`],
        [5, () => `try {\n  ${block(1)}\n  fail(${written("C")});\n  ${block(1)}\n  } catch {\n  ${block(random.between(1, 2))}\n  }${random.chance(0.3) ? ` finally {\n  ${block(1)}\n  }` : ""}`],
        [2, () => closed(() => `(() => {\n  ${block(random.between(1, 2))}\n  })();`)],
        [2, () => closed(() => written(`{\n  const answer = (() => {\n  try {\n  ${random.chance(0.5) ? block(1) + "\n  " : ""}return ${random.pick(["(1.5).toFixed(L[a & 3])", "(1.5).toFixed(L[0])", "(1.5).toFixed(L[a])", "sumOf(O) + L[1]", "O.x", "L[a & 7].toFixed(1)", "turned(O)"])};\n  } catch {}\n  })();\n  out += show(answer) + num(P.y) + " ";\n  }`))],
        [1, () => `switch (a & 3) {\n    case 0:\n  ${block(1)}\n      break;\n    case 1:\n  ${block(1)}\n    default:\n  ${block(1)}\n  }`],
      ] as const)();
    const word = mayRename ? "let" : "const";
    const alone = flats.filter(each => !/\b[OP]\b/.test(each));
    const body = `let a: number = ${random.pick(["p", "p", "p + 1", "q", "1"])};
  let b: number = ${random.pick(["q", "0.5", "p * 2", "1"])};
  let turns = 0;
  ${word} o1: Flat = ${written(random.pick(alone), [], false)};
  ${word} o2: Flat = ${written(random.chance(0.25) ? "o1" : random.pick(flats), ["o1"], false)};
  const box${hasHolder ? ` = new Holder${id}(${written("N", ["o1", "o2"], false)})` : `: Nest = ${written(random.pick(usable(nests)), ["o1", "o2"], false)}`};
  ${word} o3: Flat = ${written(random.chance(0.35) ? random.pick(usable(again)) : random.pick(flats), ["o1", "o2"])};
  const local: Flat[] = [];
  const many: number[] = [a, b, 1];
  const soft = many as any;
  ${Array.from({ length: isMaker ? random.between(0, 2) : random.between(2, 6) }, isMaker ? simple : nested).join("\n  ")}`;
    const whole = isGentle ? 'num(box.inner.x) + "," + num(box.inner.y) + box.tag + box.list.join("/")' : "show(box)";
    const end = `out += ${random.chance(0.5) ? "show(o1) + show(o2) + show(o3)" : 'num(o1.x) + "," + num(o1.y) + "," + num(o2.x) + "," + num(o2.y) + "," + num(o3.x) + "," + num(o3.y)'} + " " + ${whole}${hasHolder ? " + num(box.total())" : ""} + local.length + (o1 === o2) + (o2 === o3);`;
    if (hasHolder)
      text.push(
        `class Holder${id} {\n  ${random.pick(["inner = { x: 1, y: 2 };", "inner: Flat;", "inner: Flat = new Point(1, 2);", "inner = { x: 0.5, y: 2 };"])}\n  tag = "t";\n  list: number[] = ${random.pick(["[1]", "[]", "[0.5, 1]"])};\n  constructor(x: number) {\n    this.inner = { x, y: x };\n    this.inner.y += 1;\n  }\n  total(): number {\n    return this.inner.x + this.inner.y + this.list.length;\n  }\n}`.replace(
          random.chance(0.5) ? "this.inner = { x, y: x };\n    this.inner.y += 1;" : "\u0000",
          "this.inner = { x: x + 1, y: 3 };",
        ),
      );
    if (isMaker) {
      text.push(`function made${id}(p: number, q: number): Flat {\n  let out = "";\n  ${body}\n  return ${random.pick(["o1", "o2", "o3", "box.inner", "{ x: o1.x, y: o2.y }", "a > b ? o1 : o2", "out.length > 1000 ? o1 : o3"])};\n}`);
      continue;
    }
    const name = id - makers;
    notes.push(form + (mayRename ? "-renamed" : "") + (isGentle ? "-gentle" : "") + (hasHolder ? "-holder" : ""));
    if (form === "function") text.push(`function run${name}(p: number, q: number): string {\n  let out = "";\n  ${body}\n  ${end}\n  return out;\n}`);
    else if (form === "method") text.push(`class Home${name} {\n  run(p: number, q: number): string {\n  let out = "";\n  ${body}\n  ${end}\n  return out;\n  }\n}`);
    else if (form === "async") text.push(`async function run${name}(p: number, q: number): Promise<string> {\n  let out = "";\n  ${body}\n  ${end}\n  return out;\n}`);
    else if (form === "generator") text.push(`function* run${name}(p: number, q: number): Generator<number, string, unknown> {\n  let out = "";\n  ${body}\n  ${end}\n  return out;\n}`);
    else {
      const consumed = form === "spread" ? 'return [...steps()].join("") + out;' : `let seen = "";\n  for (const step of steps()) {\n    seen += step;\n    if (seen.length > ${random.between(0, 3)}) break;\n  }\n  return seen + out;`;
      text.push(`function run${name}(p: number, q: number): string {\n  let out = "";\n  function* steps(): Generator<string, void, unknown> {\n  ${body}\n  ${end}\n  }\n  ${consumed}\n}`);
    }
    const values = () => random.pick(["3, 60", "3, 60", "0, 1", "1, 2", "7, 0.5", "2147483640, 3", "-1, 4", "0.5, 2", "round, 2", "round + 3, round", "given[3], given[1]"]);
    const call = (given: string) => (form === "method" ? `new Home${name}().run(${given})` : form === "async" ? `(await run${name}(${given}))` : `run${name}(${given})`);
    const once = (given: string) =>
      form === "generator" ? `{\n  const steps = run${name}(${given});\n  let result = steps.next();\n  for (let i = 0; i < 60 && !result.done; i++) result = steps.next();\n  console.log("${name}: " + result.value);\n  }` : `console.log("${name}: " + ${call(given)});`;
    run.push(random.chance(0.6) ? `for (let round = 0; round < ${random.between(2, 3)}; round++) ${once(values())}` : once(values().replace(/round/g, "1")));
  }
  text.push(run.join("\n"));
  text.push('console.log(kept.map(each => (typeof each === "function" ? "f" + each() : show(each))).join(" "), show(last));');
  return `// ${notes.join(" ")}\n${text.join("\n")}`;
}
