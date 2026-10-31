// `[b, a] = [a, b]`: a list or an object that lives for one statement. A compiler need not allocate it: it can follow each part to where
// it is read. That is simple in a straight line. Each function here makes it hard: a part is null, undefined, true or false on one way
// and a value of unknown kind on another, the ways meet before the pair is taken apart, and a loop or a branch beside it, which may
// never run, can put another fresh list or object into the same variable. The functions are called with values of every kind.
// `v !== v` holds for NaN alone, which unary plus makes of most values, so a loop under that test ends by what it stores.
import type { Random } from "./random";

const constants = ["null", "undefined", "true", "false"];
const starts = [...constants, ...constants, "y", "y", "y", "z", "0", '"t"', "[y]", "{ v: y }", "Object(y)"];
const values = [
  '"ab"',
  "1",
  "null",
  "true",
  "{}",
  "2n",
  "undefined",
  "false",
  "0.5",
  "[]",
  "NaN",
  'Symbol.for("s")',
  '""',
  "-0",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const failure = typed ? "(error as Error).name" : "error.name";
  const functions: string[] = [];
  const total = random.between(8, 14);
  for (let number = 0; number < total; number++) {
    const names = random.chance(0.6) ? ["a", "b"] : ["a", "b", "c"];
    const some = () => random.pick(names);
    /** Two or three different variables. */
    const different = (count: number) => random.shuffled(names).slice(0, count);
    const constant = () => random.pick(constants);
    const test = () => {
      const [v, w] = different(2);
      return random.pick([
        `typeof ${v} === typeof ${v}`,
        `${v} === ${v}`,
        `${v} !== ${v}`,
        `${v} != ${w}`,
        `${v} == ${w}`,
        `${v} == null`,
        `${v} !== null`,
        `typeof ${v} === "object"`,
        `typeof ${v} !== typeof ${w}`,
        `Array.isArray(${v})`,
        "z",
        "!z",
        "y === z",
      ]);
    };
    const fresh = (v: string, w: string) =>
      random.pick([
        `[${v}]`,
        `[${v}, ${w}]`,
        `[${constant()}, ${v}]`,
        `{ v: ${v} }`,
        `{ v: ${constant()}, w: ${v} }`,
        `Object(${v})`,
      ]);
    const pair = (v: string, w: string) =>
      random.pick([
        `[${v}, ${w}]`,
        `[${w}, ${v}]`,
        `[${v}, ${constant()}]`,
        `[${constant()}, ${w}]`,
        `[${constant()}, ${constant()}]`,
      ]);
    /** A statement without a block of its own. */
    const simple = (): string => {
      const [v, w] = different(2);
      const u = names.length > 2 ? different(3)[2] : v;
      return random.pick([
        `[${v}, ${w}] = [${w}, ${v}];`,
        `[${v}, ${w}] = [${w}, ${v}];`,
        `[${v}, ${w}] = [${w}, ${v}];`,
        `[${v}, ${w}] = ${pair(v, w)};`,
        `[${v}, ${w}, ${u}] = [${w}, ${u}, ${v}];`,
        `({ p: ${v}, q: ${w} } = { p: ${w}, q: ${v} });`,
        `({ p: ${v}, q: ${w} } = { p: ${constant()}, q: ${v} });`,
        `[[${v}, ${w}], ${u}] = [[${w}, ${constant()}], ${v}];`,
        `[${v} = ${constant()}, ${w} = ${v}] = [${w}, ${constant()}];`,
        `[${v}, ...rest] = [${w}, ${v}, ${constant()}]; ${w} = rest[${random.below(2)}];`,
        `${v} = ${pair(v, w)}[${random.below(2)}];`,
        `${v} = { p: ${w}, q: ${constant()} }.${random.pick(["p", "q"])};`,
        `${v} = +${v};`,
        `${v} = !${v};`,
        `${v} = ${fresh(v, w)};`,
        `${v} = ${constant()};`,
        `said += typeof ${v} + ",";`,
      ]);
    };
    const several = (most: number) => Array.from({ length: random.between(1, most) }, simple).join(" ");
    const statement = (): string => {
      const [v, w] = different(2);
      return random.weighted([
        [6, () => simple()],
        [2, () => `while (${v} !== ${v}) ${v} = ${fresh(v, w)};`],
        [1, () => `while (${v} !== ${v}) { ${several(2)} ${v} = ${fresh(v, w)}; }`],
        [2, () => `for (let k = 0; k < ${random.pick(["0", "1", "2", "turns"])}; k++) ${v} = ${fresh(v, w)};`],
        [1, () => `for (let k = 0; k < ${random.pick(["1", "2", "turns"])}; k++) { ${several(2)} }`],
        [1, () => `do { ${several(2)} } while (${v} !== ${v} && spins++ < 2);`],
        [3, () => `if (${test()}) ${v} = ${fresh(v, w)};`],
        [2, () => `if (${test()}) { ${several(2)} } else { ${several(2)} }`],
        [2, () => `if (${test()}) { ${several(3)} }`],
        [2, () => `{ const held = ${test()} ? ${pair(v, w)} : ${pair(w, v)}; ${v} = held[0]; ${w} = held[1]; }`],
        [
          2,
          () =>
            `{ let held${as("any")} = ${pair(v, w)}; if (${test()}) held = ${pair(w, v)}; [${v}, ${w}] = held; }`,
        ],
        [
          1,
          () =>
            `{ let held${as("any")} = ${pair(v, w)}; while (${v} !== ${v}) { held = [held, ${w}]; ${v} = ${constant()}; } [${w}, ${v}] = held; }`,
        ],
        [
          1,
          () =>
            `{ let held${as("any")} = { p: ${v}, q: ${constant()} }; if (${test()}) held = { p: ${constant()}, q: ${w} }; ({ p: ${w}, q: ${v} } = held); }`,
        ],
        [1, () => `${v} = ((${test()}) && ${pair(v, w)}) || ${pair(w, v)}; ${v} = ${v}[${random.below(2)}];`],
        [
          1,
          () =>
            `switch (typeof ${v}) { case "object": ${w} = [${v}, ${constant()}]; break; case "string": ${w} = [${constant()}, ${v}]; break; default: ${w} = [${constant()}, ${constant()}]; } [${v}, ${w}] = ${w};`,
        ],
        [1, () => `if (Array.isArray(${v})) ${v} = ${v}[${random.below(2)}];`],
        [1, () => `if (${v} !== null && typeof ${v} === "object" && "v" in ${v}) ${v} = ${v}.v;`],
        [2, () => `if (${test()}) { ${several(3)} return said + "early " + typeof ${some()}; }`],
      ])();
    };
    /** The three together, on one variable: a part of a short-lived pair comes to where ways meet, and on one of those ways the variable gets a fresh object. */
    const motif = (): string => {
      const [v, w] = different(2);
      const enters = random.pick([
        `[${v}, ${w}] = [${w}, ${v}];`,
        `[${v}, ${w}] = [${constant()}, ${v}];`,
        `[${w}, ${v}] = [${v}, ${constant()}];`,
        `${v} = [${w}, ${constant()}][1];`,
        `({ p: ${v}, q: ${w} } = { p: ${constant()}, q: ${v} });`,
        `[${v}, ...rest] = [${constant()}, ${w}, ${v}]; ${w} = rest[${random.below(2)}];`,
      ]);
      const meets = random.pick([
        `while (${v} !== ${v}) ${v} = ${fresh(v, w)};`,
        `while (${v} !== ${v}) ${v} = ${fresh(v, w)};`,
        `if (${test()}) ${v} = ${fresh(v, w)};`,
        `for (let k = 0; k < turns; k++) ${v} = ${fresh(v, w)};`,
        `${v} = ${test()} ? ${fresh(v, w)} : ${v};`,
      ]);
      const reads = random.pick([
        `[${v}, ${w}] = [${w}, ${v}];`,
        `if (${v} != ${w}) { [${w}, ${v}] = [${v}, ${w}]; ${v} = +${v}; return said + "early " + typeof ${w}; }`,
        `if (${test()}) { [${v}, ${w}] = [${w}, ${v}]; ${simple()} } else { ${simple()} }`,
        `{ const held = [${v}, ${w}]; ${w} = held[0]; ${v} = held[1]; }`,
        `said += typeof ${v} + ",";`,
      ]);
      return (random.chance(0.5) ? [enters, meets, reads] : [meets, enters, reads]).join("\n  ");
    };
    const body = Array.from({ length: random.between(2, 5) }, () => (random.chance(0.55) ? motif() : statement()));
    functions.push(`function go${number}(y${as("any")}, z${as("any")}, turns${as("number")})${as("string")} {
  let ${names.map(name => `${name}${as("any")} = ${random.pick(starts)}`).join(", ")};
  let rest${as("any[]")} = [];
  let said = "";
  let spins = 0;
  ${body.join("\n  ")}
  return said + [${names.join(", ")}, rest.length].map(describe).join(" ");
}
{
  const lines${as("string[]")} = [];
  for (const value of values)
    for (const other of [null, true, value]) {
      try {
        lines.push(go${number}(value, other, lines.length % 3));
      } catch (error) {
        lines.push("threw " + ${failure});
      }
    }
  console.log("go${number}", lines.join(" | "));
}`);
  }
  return `const values${as("any[]")} = [${random.shuffled(values).join(", ")}];
function describe(value${as("any")})${as("string")} {
  if (value === null) return "null";
  if (Array.isArray(value)) return "[" + value.map(describe).join() + "]";
  if (typeof value === "object") return "{" + Object.keys(value).map(key => key + ":" + describe(value[key])).join() + "}" + typeof value.valueOf();
  if (typeof value === "symbol") return "symbol";
  if (typeof value === "bigint") return value + "n";
  return Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : String(value);
}
${functions.join("\n")}
${typed ? "export {};\n" : ""}`;
}
