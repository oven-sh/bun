// `o.n = o.n + 1` in a loop loads the word that the turn before stored. A compiler can carry the word round the loop in a register, as long as
// nothing else in the loop writes it. Something else can: the same object under a second parameter, the same list under another name and an
// index that happens to be equal, a second view over the same bytes, a function that sets the module's variable.
// Each function has a loop that reads and writes one place by a first name. In some turns the place is written or read by a second name,
// straight, through a helper, a method or a closure. Beside that stand accesses to the place that only some kinds of holder reach: behind
// `instanceof`, `in` or a tag, through a helper that takes one class alone. Each function is called with two things and with one thing under
// both names, and with holders of each class. The arithmetic is in whole numbers, so that no rare path stands in the loop.
// A compiler can also leave the store for behind the loop. So some loops are left early, by `return`, `break` or `throw`, or stand still at a
// `yield`, and the place is then read by the second name.
import type { Random } from "./random";

const classes = ["Plain", "Other", "Wide"] as const;

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const body: string[] = [];
  const helpers = new Set<string>();
  const guarded = (call: string) => `safe(() => ${call})`;
  const turnOf = () => random.pick(["0", "1", "1", "2", "3", "turns - 1"]);
  const when = (j: string) => random.weighted([
    [5, `${j} === ${turnOf()}`],
    [2, `${j} % 3 === ${random.below(3)}`],
    [1, `${j} > ${random.between(0, 2)}`],
    [1, `(${j} & 1) === 0`],
  ]);
  const stored = () => random.pick(["50", "50", "-7", "0", "1000", "j", "(j * 10) | 0"]);
  const stepOf = (place: string) =>
    random.weighted([
      [5, `${place} = (${place} + ${random.between(1, 3)}) | 0;`],
      [2, `${place} += ${random.between(1, 3)};`],
      [2, `${place}++;`],
      [1, `${place} = (Math.imul(${place}, 3) + 1) | 0;`],
      [1, `${place} = (${place} ^ j) | 0;`],
      [1, `${place} = (${place} + j) | 0;`],
    ]);
  /** Statements that leave the loop, or look at the place from outside it, with the place as the second name reads it. */
  const waysOut = (seen: string): [number, () => string][] => [
    [2, () => `if (${when("j")}) return (${seen} * 1000 + sum + 1) | 0;`],
    [2, () => `if (${when("j")}) break;`],
    [2, () => `if (${when("j")}) throw new Left(${seen});`],
    [2, () => `try { if (${when("j")}) fail(); } catch { sum = (sum + ${seen}) | 0; }`],
    [1, () => `if (${when("j")}) looked.push(${seen});`],
    [1, () => `if (${when("j")}) continue;`],
  ];
  const someWaysOut = (seen: string) => (random.chance(0.35) ? [random.weighted(waysOut(seen))()] : []);
  const loopOf = (lines: string[]) => {
    const inner = lines.map(line => "    " + line);
    const stepsByHand = lines.some(line => line.endsWith("continue;")) ? 0 : 1;
    return random.weighted([
      [6, ["  for (let j = 0; j < turns; j++) {", ...inner, "  }"]],
      [stepsByHand, ["  let j = 0;", "  while (j < turns) {", ...inner, "    j++;", "  }"]],
      [stepsByHand, ["  let j = 0;", "  if (turns > 0) do {", ...inner, "    j++;", "  } while (j < turns);"]],
      [1, ["  for (let round = 0; round < 2; round++) for (let j = 0; j < turns; j++) {", ...inner, "  }"]],
    ]);
  };

  const functions = random.weighted([
    [4, 1],
    [3, 2],
    [1, 3],
  ]);
  for (let at = 1; at <= functions; at++) {
    const place = random.weighted([
      [8, "a field"],
      [3, "an element of a list"],
      [3, "an element of a view"],
      [2, "a variable of the module"],
      [2, "a static field"],
    ] as const);
    const name = `run${at}`;
    const lines: string[] = [];

    if (place === "a field") {
      const field = random.pick(["n", "n", "m"]);
      const held = random.sample(classes, random.weighted([[2, 1], [5, 2], [3, 3]]));
      const second = random.chance(0.75) ? [random.pick(held)] : random.sample(held, Math.min(2, held.length));
      const narrow = random.pick(classes.filter(each => held.includes(each)));
      const test = random.weighted([
        [5, `holder instanceof ${narrow}`],
        [narrow === "Other" ? 2 : 0, `"k" in holder`],
        [narrow === "Wide" ? 2 : 0, `"a" in holder`],
        [2, `holder.tag === ${classes.indexOf(narrow)}`],
      ]);
      const narrowed = typed && test.startsWith("holder.tag") ? `(holder as ${narrow})` : "holder";
      const helperFor = (what: "bump" | "read" | "set") => {
        const helper = `${what}${narrow}${field.toUpperCase()}`;
        helpers.add(
          what === "bump"
            ? `function ${helper}(o${as(narrow)})${as("void")} { o.${field} = (o.${field} + o.step) | 0; }`
            : what === "read"
              ? `function ${helper}(o${as(narrow)})${as("number")} { return o.${field}; }`
              : `function ${helper}(o${as(narrow)}, v${as("number")})${as("void")} { o.${field} = v; }`,
        );
        return helper;
      };
      const statements: [number, () => string][] = [
        [6, () => `if (${when("j")}) other.${field} = ${stored()};`],
        [2, () => `if (${when("j")}) other.${field} = (other.${field} + 7) | 0;`],
        [1, () => `other.${field} = (other.${field} ^ 1) | 0;`],
        [2, () => `sum = (sum + other.${field}) | 0;`],
        [2, () => `sum = (sum + holder.${field}) | 0;`],
        [4, () => `if (${test}) ${helperFor("bump")}(${narrowed});`],
        [2, () => `if (${test}) sum = (sum + ${helperFor("read")}(${narrowed})) | 0;`],
        [2, () => `if (${test}) ${helperFor("set")}(${narrowed}, (holder.${field} + 1) | 0);`],
        [2, () => `if (${test}) ${narrowed}.bump${field.toUpperCase()}();`],
        [1, () => `if (${test}) ${narrowed}.${field} = (${narrowed}.${field} + 2) | 0;`],
        [1, () => `if (${when("j")}) other.bump${field.toUpperCase()}();`],
        [1, () => `if (j < 0) sum = (sum + ${helperFor("read")}(${typed ? `(holder as ${narrow})` : "holder"})) | 0;`],
        [1, () => `if (j === 1000) kept.push(holder);`],
      ];
      const inLoop = [stepOf(`holder.${field}`), random.weighted(statements.slice(0, 3))()];
      for (let more = random.between(1, 3); more > 0; more--) inLoop.push(random.weighted(statements)());
      inLoop.push(...someWaysOut(`other.${field}`));
      lines.push(
        `function ${name}(holder${as(held.join(" | "))}, other${as(second.join(" | "))}, turns${as("number")})${as("number")} {`,
        "  let sum = 0;",
        ...loopOf(random.chance(0.5) ? inLoop : random.shuffled(inLoop)),
        `  return (holder.${field} * 1000 + sum) | 0;`,
        "}",
      );
      const calls: string[] = [];
      for (const first of held) for (const other of second) calls.push(`${name}(new ${first}(), new ${other}(), turns)`);
      for (const both of second) calls.push(`((one${as(both)}) => ${name}(one, one, turns))(new ${both}())`);
      body.push(...lines, `console.log("r${at}", ${random.shuffled(calls).map(guarded).join(", ")}, looked.splice(0).join());`);
      continue;
    }

    if (place === "an element of a list") {
      const inLoop = [
        stepOf("list[k]"),
        random.weighted([
          [5, `if (${when("j")}) same[k2] = ${stored()};`],
          [2, `if (${when("j")}) same[k2] = (same[k2] + 7) | 0;`],
          [1, `if (${when("j")}) same.fill(${random.pick(["50", "0"])});`],
          [1, `if (${when("j")}) same.reverse();`],
          [1, `if (${when("j")}) put(same, k2, ${stored()});`],
          [1, `if (${when("j")}) same.length = 1;`],
        ]),
        ...random.sample(["sum = (sum + same[k2]) | 0;", "sum = (sum + list[k]) | 0;", "if (j < 0) sum = (sum + list[k]) | 0;", "sum = (sum + list.length) | 0;", "if (j === 1000) kept.push(list);"], random.between(0, 2)),
        ...someWaysOut("(same[k2] | 0)"),
      ];
      helpers.add(`function put(list${as("number[]")}, at${as("number")}, v${as("number")})${as("void")} { list[at] = v; }`);
      body.push(
        `function ${name}(list${as("number[]")}, same${as("number[]")}, k${as("number")}, k2${as("number")}, turns${as("number")})${as("number")} {`,
        "  let sum = 0;",
        ...loopOf(random.chance(0.5) ? inLoop : random.shuffled(inLoop)),
        "  return ((list[k] | 0) * 1000 + sum) | 0;",
        "}",
        `console.log("r${at}", ${random
          .shuffled([
            `${name}([1, 2, 3], [4, 5, 6], 1, 1, turns)`,
            `((one${as("number[]")}) => ${name}(one, one, 1, 1, turns))([1, 2, 3])`,
            `((one${as("number[]")}) => ${name}(one, one, 1, 2, turns))([1, 2, 3])`,
            `((one${as("number[]")}) => ${name}(one, one, 0, zero, turns))([1, 2, 3])`,
          ])
          .map(guarded)
          .join(", ")}, looked.splice(0).join());`,
      );
      continue;
    }

    if (place === "an element of a view") {
      const [firstView, secondView] = random.pick([
        ["Int32Array", "Int32Array"],
        ["Int32Array", "Uint8Array"],
        ["Int32Array", "Int16Array"],
        ["Uint8Array", "Int32Array"],
        ["Float64Array", "Int32Array"],
        ["Int32Array", "DataView"],
      ] as const);
      const write = (value: string) => (secondView === "DataView" ? `bytes.setInt32(0, ${value}, true);` : `bytes[k2] = ${value};`);
      const read = secondView === "DataView" ? "bytes.getInt32(0, true)" : "bytes[k2]";
      const inLoop = [
        stepOf("view[k]"),
        `if (${when("j")}) ${write(stored())}`,
        ...random.sample([`sum = (sum + ${read}) | 0;`, "sum = (sum + view[k]) | 0;", "if (j < 0) sum = (sum + view[k]) | 0;", "if (j === 1000) kept.push(view);"], random.between(0, 2)),
        ...someWaysOut(`(${read} | 0)`),
      ];
      const made = (buffer: string, view: string) => `new ${view}(${buffer})`;
      body.push(
        `function ${name}(view${as(firstView)}, bytes${as(secondView)}, k${as("number")}, k2${as("number")}, turns${as("number")})${as("number")} {`,
        "  let sum = 0;",
        ...loopOf(random.chance(0.5) ? inLoop : random.shuffled(inLoop)),
        "  return ((view[k] | 0) * 1000 + sum) | 0;",
        "}",
        `console.log("r${at}", ${random
          .shuffled([
            `${name}(${made("new ArrayBuffer(16)", firstView)}, ${made("new ArrayBuffer(16)", secondView)}, 0, 0, turns)`,
            `((buffer${as("ArrayBuffer")}) => ${name}(${made("buffer", firstView)}, ${made("buffer", secondView)}, 0, 0, turns))(new ArrayBuffer(16))`,
            `((buffer${as("ArrayBuffer")}) => ${name}(${made("buffer", firstView)}, ${made("buffer", secondView)}, 0, zero, turns))(new ArrayBuffer(16))`,
            `((buffer${as("ArrayBuffer")}) => ${name}(${made("buffer", firstView)}, ${made("buffer", secondView)}, 1, 0, turns))(new ArrayBuffer(16))`,
          ])
          .map(guarded)
          .join(", ")}, looked.splice(0).join());`,
      );
      continue;
    }

    if (place === "a variable of the module") {
      const inLoop = [
        stepOf(`total${at}`),
        random.weighted([
          [4, `if (${when("j")}) setTotal${at}(${stored()});`],
          [2, `if (${when("j")}) writers${at}[zero](${stored()});`],
          [2, `if (${when("j")}) write(${stored()});`],
        ]),
        ...random.sample([`sum = (sum + total${at}) | 0;`, `sum = (sum + readTotal${at}()) | 0;`, `if (j < 0) sum = (sum + total${at}) | 0;`], random.between(0, 2)),
        ...someWaysOut(`readTotal${at}()`),
      ];
      body.push(
        `let total${at} = 1;`,
        `function setTotal${at}(v${as("number")})${as("void")} { total${at} = v; }`,
        `function readTotal${at}()${as("number")} { return total${at}; }`,
        `const writers${at} = [setTotal${at}];`,
        `function ${name}(write${as("(v: number) => void")}, turns${as("number")})${as("number")} {`,
        "  let sum = 0;",
        ...loopOf(random.chance(0.5) ? inLoop : random.shuffled(inLoop)),
        `  return (total${at} * 1000 + sum) | 0;`,
        "}",
        `console.log("r${at}", ${[`${name}(setTotal${at}, turns)`, `${name}(() => {}, turns)`, `${name}(v => { total${at} = (v + 1) | 0; }, turns)`].map(guarded).join(", ")}, looked.splice(0).join());`,
      );
      continue;
    }

    const inLoop = [
      stepOf("Counted.n"),
      random.weighted([
        [4, `if (${when("j")}) alias.n = ${stored()};`],
        [2, `if (${when("j")}) Counted.set(${stored()});`],
        [2, `if (${when("j")}) alias.set(${stored()});`],
      ]),
      ...random.sample(["sum = (sum + alias.n) | 0;", "sum = (sum + Counted.n) | 0;", "if (j < 0) sum = (sum + Counted.n) | 0;"], random.between(0, 2)),
      ...someWaysOut("alias.n"),
    ];
    helpers.add(`class Counted { static n = 1; static set(v${as("number")})${as("void")} { Counted.n = v; } }`);
    helpers.add(`class Apart { static n = 1; static set(v${as("number")})${as("void")} { Apart.n = v; } }`);
    body.push(
      `function ${name}(alias${as("typeof Counted | typeof Apart")}, turns${as("number")})${as("number")} {`,
      "  let sum = 0;",
      ...loopOf(random.chance(0.5) ? inLoop : random.shuffled(inLoop)),
      "  return (Counted.n * 1000 + sum) | 0;",
      "}",
      `console.log("r${at}", ${[`${name}(Apart, turns)`, `${name}(Counted, turns)`, `${name}(Apart, turns)`].map(guarded).join(", ")}, looked.splice(0).join());`,
    );
  }

  const member = (field: string, step: string) => `bump${field.toUpperCase()}()${as("void")} { this.${field} = (this.${field} + ${step}) | 0; }`;
  return [
    `class Plain { tag = 0; n = 1; m = 2; step = 2; ${member("n", "2")} ${member("m", "2")} }`,
    `class Other { tag = 1; n = 1; k = 3; m = 2; step = 3; ${member("n", "this.k")} ${member("m", "this.k")} }`,
    `class Wide { a = 0; b = 0; tag = 2; step = 5; m = 2; n = 1; ${member("n", "5")} ${member("m", "5")} }`,
    `const kept${as("unknown[]")} = [];`,
    `const turns${as("number")} = JSON.parse("${random.between(3, 9)}");`,
    `const zero${as("number")} = JSON.parse("0");`,
    `const looked${as("number[]")} = [];`,
    `class Left { seen${as("number")}; constructor(seen${as("number")}) { this.seen = seen; } }`,
    `function fail()${as("never")} { throw new Left(0); }`,
    `function safe(f${as("() => number")})${as("number | string")} { try { return f(); } catch (e) { return e instanceof Left ? "left " + e.seen : "another error"; } }`,
    ...helpers,
    ...body,
    "export {};",
  ].join("\n");
}
