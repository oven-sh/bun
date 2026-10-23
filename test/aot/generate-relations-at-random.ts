// The programs of relations-at-random: made by chance, one for each seed, the same ones every time. `bun test/aot/generate.ts relations-at-random <where>` writes those of the seeds 1 to 80.
//
//   bun test/aot/generate-relations-at-random.ts --folder <folder> [--seeds <n>] [--first <seed>] [--who-keeps]      other seeds, or more of them
//
// programs/relational-summaries/ has one program, written by hand, for each thing that a function can do with what it is handed. These
// mix them: some ten helpers that read, write, link, keep, return, throw, wrap, compare and hand on their parameters, call each other,
// themselves and the closures they are passed; a loop that makes fresh objects and closures for every call and looks at them afterwards.
// What anybody still holds at the end is printed as a graph, when the frames that made it are gone and the collector has run.
// A compiler that believes one false thing about one helper prints another graph than plain Bun, or dies.
// An even seed gives a TypeScript program, an odd one the same kind of program without types.
// --who-keeps: each program ends by calling every helper 300 times with fresh objects and closures that nobody else holds, and prints
// `KEPT h<helper> parameter <index>: <how many>` for those that are still alive a turn and two collections later (100 + index: the
// object that the parameter holds in its field `a`). Run by plain Bun that
// is the truth about each parameter: whoever says of such a parameter that the helper keeps it nowhere is wrong. And
// `ANSWERED h<helper> <null | parameter <index> | what a parameter holds (when it is handed over) | a new object | an object it has answered before>: <how often>`. (The collector scans
// the stack conservatively: a count of one or two may be chance. Such programs are no tests: the counts are not the same every time.)
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import type { WrittenProgram } from "./generate";

const asksWhoKeeps = import.meta.main && process.argv.includes("--who-keeps");

function randomNumbers(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    below: (limit: number) => Math.floor(next() * limit),
    chance: (probability: number) => next() < probability,
    pick: <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)],
  };
}

interface Helper {
  objects: number;
  functions: number;
}

/** Nothing where the helpers of this attempt call each other too often for a test. */
function program(seed: number, attempt: number): string | null {
  const random = randomNumbers(seed + attempt * 1_000_003);
  const typed = seed % 2 === 0;
  const type = (text: string) => (typed ? text : "");
  const object = type(": Obj");
  const nullable = type(": Obj | null");
  const sure = type("!");
  const asObject = type(" as Obj");
  const field = () => random.pick(["a", "b"]);
  const rarely = (x: string) => `${x}.n % ${random.pick([31, 37, 41, 53, 61, 71, 89])} === ${random.below(30)}`;
  const helpers: Helper[] = Array.from({ length: 6 + random.below(5) }, () => ({ objects: 1 + random.below(3), functions: random.chance(0.4) ? 1 : 0 }));
  const callsOf: number[][] = helpers.map(() => []);
  let names = 0;
  let sites = 0;
  const fresh = (prefix: string) => prefix + names++;
  const literal = (from: string, a: string) =>
    random.chance(0.25) ? `new Made("c${sites++}." + ${from}.n, ${from}.n + ${1 + random.below(9)}, ${a})` : `{ tag: "s${sites++}." + ${from}.n, n: ${from}.n + ${1 + random.below(9)}, a: ${a}, b: null }`;

  /** One statement that needs nothing but objects that are there. */
  function simple(objects: string[]): string {
    const x = random.pick(objects);
    const y = random.pick(objects);
    switch (random.below(7)) {
      case 0:
      case 1:
        return `${x}.${field()} = ${y};`;
      case 2:
        return `if (${rarely(x)}) kept.push(${y});`;
      case 3:
        return `${x}.n += ${1 + random.below(5)};`;
      case 4:
        return `if (${x} === ${y}) ${x}.n += 1000;`;
      case 5:
        return `if (${rarely(x)}) slot = ${y};`;
      default:
        return `${x}.${field()} = null;`;
    }
  }

  function closure(objects: string[], indent: string): string {
    const lines = [`(v${object})${nullable} => {`];
    const inside = [...objects, "v"];
    for (let i = random.below(3); i >= 0; i--) lines.push(indent + "  " + simple(inside));
    lines.push(indent + "  return " + random.pick([...inside, "null", "v", literal("v", random.pick([...inside, "null"]))]) + ";");
    lines.push(indent + "}");
    return lines.join("\n");
  }

  function argumentsFor(callee: Helper, objects: string[], functions: string[], depth: string, indent: string): string {
    const list: string[] = [];
    for (let i = 0; i < callee.objects; i++) list.push(random.chance(0.25) ? literal(random.pick(objects), random.pick([...objects, "null"])) : random.pick(objects));
    for (let i = 0; i < callee.functions; i++) list.push(functions.length > 0 && random.chance(0.5) ? random.pick(functions) : closure(objects, indent));
    list.push(depth);
    return list.join(", ");
  }

  function body(index: number): string[] {
    const self = helpers[index];
    const objects = Array.from({ length: self.objects }, (_, i) => "p" + i);
    const functions = Array.from({ length: self.functions }, (_, i) => "f" + i);
    const maybe: string[] = [];
    const lines: string[] = [];
    const later = helpers.map((_, i) => i).filter(i => i > index);
    for (let count = 3 + random.below(6); count > 0; count--) {
      const x = random.pick(objects);
      const y = random.pick(objects);
      switch (random.below(26)) {
        case 0: {
          const t = fresh("t");
          lines.push(random.chance(0.3) ? `const { ${field()}: ${t} } = ${x};` : `const ${t} = ${x}.${field()};`);
          maybe.push(t);
          break;
        }
        case 16: {
          const c = fresh("c");
          lines.push(`const ${c} = ${x}.n % 2 === 0 ? ${x} : ${y};`);
          objects.push(c);
          break;
        }
        case 17: {
          const c = fresh("c");
          lines.push(`let ${c} = ${x};`, `for (let k = 0; k < 3; k++) ${c} = ${c}.${field()} ?? ${y};`);
          objects.push(c);
          break;
        }
        case 18:
          lines.push(`for (const v of both(${x}, ${y})) {`, "  " + simple([...objects, "v"]), "}");
          break;
        case 19:
          lines.push(random.chance(0.5) ? `holder.hold(${x});` : `if (${rarely(x)}) holder.hold(${y});`);
          break;
        case 20: {
          const t = fresh("t");
          lines.push(`const ${t} = holder.take();`);
          maybe.push(t);
          break;
        }
        case 21:
          lines.push(`bag.set(${x}.n % 5, ${y});`);
          break;
        case 22: {
          const t = fresh("t");
          lines.push(`const ${t} = bag.get(${x}.n % 5) ?? null;`);
          maybe.push(t);
          break;
        }
        case 23:
          if (later.length > 0) {
            const callee = random.pick(later);
            callsOf[index].push(callee);
            const r = fresh("r");
            const list = argumentsFor(helpers[callee], objects, functions, "d", "");
            lines.push(random.chance(0.5) ? `const ${r} = h${callee}.call(null, ${list});` : `const ${r} = h${callee}.apply(null, [${list}]);`);
            maybe.push(r);
          }
          break;
        case 24: {
          const g = fresh("g");
          lines.push(`const ${g} = first.bind(null, ${x});`);
          functions.push(g);
          break;
        }
        case 25:
          lines.push("try {", "  " + simple(objects), `  if (${rarely(x)}) throw ${y};`, "} finally {", "  " + simple(objects), "}");
          break;
        case 1:
          if (maybe.length > 0) {
            const t = random.pick(maybe);
            lines.push(`if (${t} !== null) {`, "  " + simple([...objects, t]), "}");
          }
          break;
        case 2: {
          const o = fresh("o");
          lines.push(`const ${o}${object} = ${literal(x, random.pick([...objects, "null"]))};`);
          objects.push(o);
          break;
        }
        case 3:
        case 4:
          if (later.length > 0) {
            const callee = random.pick(later);
            callsOf[index].push(callee);
            const r = fresh("r");
            lines.push(`const ${r} = h${callee}(${argumentsFor(helpers[callee], objects, functions, "d", "")});`);
            maybe.push(r);
          }
          break;
        case 5: {
          callsOf[index].push(index);
          const r = fresh("r");
          lines.push(`const ${r} = d > 0 ? h${index}(${argumentsFor(self, objects, functions, "d - 1", "")}) : null;`);
          maybe.push(r);
          break;
        }
        case 6:
          if (functions.length > 0) {
            const r = fresh("r");
            lines.push(`const ${r} = ${random.pick(functions)}(${x});`);
            maybe.push(r);
          }
          break;
        case 7: {
          const g = fresh("g");
          lines.push(`const ${g} = ${closure(objects, "")};`);
          functions.push(g);
          break;
        }
        case 8: {
          const t = fresh("t");
          lines.push(`const ${t} = slot;`);
          maybe.push(t);
          break;
        }
        case 9:
          lines.push(`if (${rarely(x)}) throw ${y};`);
          break;
        case 10:
          if (later.length > 0) {
            const callee = random.pick(later);
            callsOf[index].push(callee);
            const r = fresh("r");
            lines.push(`let ${r}${nullable} = null;`, "try {", `  ${r} = h${callee}(${argumentsFor(helpers[callee], objects, functions, "d", "  ")});`, "} catch (e) {", `  ${r} = e${asObject};`, "}");
            maybe.push(r);
          }
          break;
        case 11: {
          const l = fresh("l");
          lines.push(`const ${l} = [${x}, ${y}];`, `${l}[${random.below(2)}].${field()} = ${random.pick(objects)};`);
          break;
        }
        case 12: {
          const w = fresh("w");
          lines.push(`const ${w}${object} = ${literal(x, y)};`, `${w}.a${sure}.${field()} = ${random.pick(objects)};`);
          break;
        }
        case 13:
          if (functions.length > 0) lines.push(`if (${rarely(x)}) keptFunctions.push(${random.pick(functions)});`);
          break;
        default:
          lines.push(simple(objects));
      }
    }
    lines.push("return " + random.pick([...objects, ...maybe, "null", literal(random.pick(objects), random.pick([...objects, "null"]))]) + ";");
    return lines;
  }

  const out: string[] = [];
  out.push(`// Made by test/aot/generate-relations-at-random.ts, seed ${seed}: helpers that do by chance what a function can do with what it is handed. What is still held at the end is printed as a graph.`);
  if (typed) out.push("interface Obj {", "  tag: string;", "  n: number;", "  a: Obj | null;", "  b: Obj | null;", "}", "type Fn = (v: Obj) => Obj | null;");
  out.push(`const kept${type(": Obj[]")} = [];`, `const keptFunctions${type(": Fn[]")} = [];`, `let slot${nullable} = null;`);
  out.push(
    `function churn(depth${type(": number")})${type(": number")} {`,
    "  const pair = { left: depth, right: -depth };",
    "  const list = [depth, depth + 1, depth + 2];",
    "  const read = () => pair.left + list[1];",
    "  if (depth > 0) return churn(depth - 1) + read();",
    "  Bun.gc(true);",
    "  return read();",
    "}",
    "class Made {",
    ...(typed ? ["  b: Obj | null = null;", "  constructor(", "    public tag: string,", "    public n: number,", "    public a: Obj | null,", "  ) {}"] : ["  b = null;", "  constructor(tag, n, a) {", "    this.tag = tag;", "    this.n = n;", "    this.a = a;", "  }"]),
    "}",
    "class Holder {",
    `  held${nullable} = null;`,
    `  hold(o${object})${type(": void")} {`,
    "    this.held = o;",
    "  }",
    `  take()${nullable} {`,
    "    const o = this.held;",
    "    this.held = null;",
    "    return o;",
    "  }",
    "}",
    "const holder = new Holder();",
    `const bag = new Map${type("<number, Obj>")}();`,
    `function* both(x${object}, y${object})${type(": Generator<Obj>")} {`,
    "  yield x;",
    "  yield y;",
    "}",
    `function first(x${object}, y${object})${nullable} {`,
    "  y.n += 1;",
    "  return x;",
    "}",
    `function spy(tag${type(": string")}, n${type(": number")})${object} {`,
    `  let inner${nullable} = null;`,
    "  return {",
    "    tag,",
    "    n,",
    "    b: null,",
    "    get a() {",
    "      if (kept.length < 400) kept.push(this);",
    "      return inner;",
    "    },",
    "    set a(v) {",
    "      if (v !== null && kept.length < 400) kept.push(v);",
    "      inner = v;",
    "    },",
    "  };",
    "}",
  );
  helpers.forEach((helper, index) => {
    const parameters = [...Array.from({ length: helper.objects }, (_, i) => `p${i}${object}`), ...Array.from({ length: helper.functions }, (_, i) => `f${i}${type(": Fn")}`), `d${type(": number")}`];
    out.push(`function h${index}(${parameters.join(", ")})${nullable} {`, ...body(index).flatMap(line => line.split("\n")).map(line => "  " + line), "}");
  });
  const activations = (index: number, depth: number): number => callsOf[index].reduce((sum, callee) => sum + (callee !== index ? activations(callee, depth) : depth > 0 ? activations(index, depth - 1) : 0), 1);
  if (helpers.some((_, index) => activations(index, 2) > 3000)) return null;
  out.push(`const caught${type(": Obj[]")} = [];`, "let sum = 0;", "for (let i = 0; i < 300; i++) {");
  const mine = ["o0", "o1", "o2"];
  out.push(`  const o0${object} = { tag: "o0." + i, n: i, a: null, b: null };`, `  const o1${object} = i % 59 === 7 ? spy("spy." + i, i) : { tag: "o1." + i, n: i * 2, a: null, b: null };`, `  const o2${object} = { tag: "o2." + i, n: i + 5, a: o0, b: null };`);
  for (let count = 3 + random.below(3); count > 0; count--) {
    const callee = random.below(helpers.length);
    const r = fresh("r");
    out.push("  try {", `    const ${r} = h${callee}(${argumentsFor(helpers[callee], mine, [], String(random.below(3)), "    ")});`, `    if (${r} !== null) {`, `      sum += ${r}.n;`, `      if (${rarely(r)}) kept.push(${r});`, "    }", "  } catch (e) {", `    caught.push(e${asObject});`, "  }");
  }
  out.push("  sum += o0.n + o2.n + (o0.b !== null ? o0.b.n : 0) + (o2.a !== null ? o2.a.n : 0) + (o0 === o2.a ? 1 : 0);", "  if (i % 100 === 50) churn(20);", "}");
  out.push(
    "console.log(sum, churn(60), kept.length, keptFunctions.length, caught.length);",
    `const probe${object} = { tag: "probe", n: 3, a: null, b: null };`,
    `const roots${type(": (Obj | null)[]")} = [slot, holder.held, ...bag.values(), ...kept, ...caught, ...keptFunctions.map(f => f(probe)), probe];`,
    `const numbers = new Map${type("<Obj, number>")}();`,
    `const queue${type(": Obj[]")} = [];`,
    `const numberOf = (o${nullable})${type(": string")} => {`,
    '  if (o === null) return "-";',
    "  let number = numbers.get(o);",
    "  if (number === undefined) {",
    "    number = numbers.size;",
    "    numbers.set(o, number);",
    "    queue.push(o);",
    "  }",
    "  return String(number);",
    "};",
    'console.log(roots.map(numberOf).join(" "));',
    "kept.length = 400;",
    "for (let at = 0; at < queue.length && at < 500; at++) {",
    "  const o = queue[at];",
    '  console.log(at + " " + o.tag + " " + o.n + " " + numberOf(o.a) + " " + numberOf(o.b));',
    "}",
    "console.log(numbers.size);",
  );
  if (asksWhoKeeps) {
    out.push(
      `const watched${type(": [number, number, WeakRef<object>][]")} = [];`,
      `function watch${type("<T extends object>")}(helper${type(": number")}, parameter${type(": number")}, value${type(": T")})${type(": T")} {`,
      "  watched.push([helper, parameter, new WeakRef(value)]);",
      "  return value;",
      "}",
      `const answers = new Map${type("<string, number>")}();`,
      `const answeredBefore = new WeakSet${type("<object>")}();`,
      `function answer(helper${type(": number")}, result${nullable}, handed${type(": Obj[]")}, heldBefore${type(": (Obj | null)[]")})${type(": void")} {`,
      '  let what = "a new object";',
      '  if (result === null) what = "null";',
      '  else if (handed.includes(result)) what = "parameter " + handed.indexOf(result);',
      '  else if (heldBefore.includes(result)) what = "what a parameter holds";',
      '  else if (answeredBefore.has(result)) what = "an object it has answered before";',
      "  if (result !== null) answeredBefore.add(result);",
      '  const name = "h" + helper + " " + what;',
      "  answers.set(name, (answers.get(name) ?? 0) + 1);",
      "}",
      `function ask()${type(": void")} {`,
      "  for (let r = 0; r < 300; r++) {",
    );
    helpers.forEach((helper, index) => {
      const handed = Array.from({ length: helper.objects }, (_, i) => "w" + i);
      const list = [...handed, ...Array.from({ length: helper.functions }, (_, i) => `watch(${index}, ${helper.objects + i}, (v${object})${nullable} => v)`), "1"];
      out.push(
        "    try {",
        ...handed.map((name, i) => `      const ${name} = watch(${index}, ${i}, { tag: "w", n: r, a: watch(${index}, ${100 + i}, { tag: "x", n: r, a: null, b: null }${asObject}), b: null }${asObject});`),
        `      const heldBefore = [${handed.map(name => name + ".a").join(", ")}];`,
        `      answer(${index}, h${index}(${list.join(", ")}), [${handed.join(", ")}], heldBefore);`,
        "    } catch {}",
      );
    });
    out.push(
      "  }",
      "}",
      "ask();",
      "await new Promise(resolve => setTimeout(resolve, 1));",
      "churn(90);",
      "await new Promise(resolve => setTimeout(resolve, 1));",
      "churn(90);",
      `const alive = new Map${type("<string, number>")}();`,
      "for (const [helper, parameter, reference] of watched) {",
      "  if (reference.deref() === undefined) continue;",
      '  const name = "h" + helper + " parameter " + parameter;',
      "  alive.set(name, (alive.get(name) ?? 0) + 1);",
      "}",
      'for (const [name, count] of alive) console.log("KEPT " + name + ": " + count);',
      'for (const [name, count] of answers) console.log("ANSWERED " + name + ": " + count);',
    );
  }
  return out.join("\n") + "\n";
}

export function programsOfSeeds(firstSeed: number, numberOfSeeds: number): WrittenProgram[] {
  return Array.from({ length: numberOfSeeds }, (_, index) => {
    const seed = firstSeed + index;
    let text: string | null = null;
    for (let attempt = 0; text === null; attempt++) text = program(seed, attempt);
    const entry = `seed-${String(seed).padStart(4, "0")}.${seed % 2 === 0 ? "ts" : "js"}`;
    return { entry, files: { [entry]: text } };
  });
}

export const programs = (): WrittenProgram[] => programsOfSeeds(1, 80);

if (import.meta.main) {
  const option = (name: string, otherwise: string): string => {
    const index = process.argv.indexOf(name);
    return index === -1 ? otherwise : (process.argv[index + 1] ?? otherwise);
  };
  const folder = option("--folder", "");
  if (folder === "") {
    console.error("bun test/aot/generate-relations-at-random.ts --folder <folder> [--seeds <n>] [--first <seed>] [--who-keeps]");
    process.exit(1);
  }
  mkdirSync(folder, { recursive: true });
  for (const name of readdirSync(folder)) if (/^seed-\d+\.[jt]s$/.test(name)) rmSync(join(folder, name));
  const made = programsOfSeeds(Number(option("--first", "1")), Number(option("--seeds", "120")));
  for (const { entry, files } of made) writeFileSync(join(folder, entry), files[entry]);
  console.log(`${made.length} programs in ${folder}`);
}
