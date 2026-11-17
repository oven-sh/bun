// `[b, a] = [a, b]`: a list or an object that lives for one statement. A compiler need not allocate it: it can follow each part to where
// it is read. That is simple in a straight line. Each function here makes it hard: a part is null, undefined, true or false on one way
// and a value of unknown kind on another, the ways meet before the pair is taken apart, and a loop or a branch beside it, which may
// never run, can put another fresh list or object into the same variable. A parameter can be one of the variables. Half of the functions
// are called with values of every kind and half with one kind alone, which lets a compiler decide some of the tests. Some hand back a text
// about their variables, the others a variable from the middle of a branch and a fresh object, a constant or a variable at their end.
// One variable may stay out of every pair: a constant, or by a parameter a fresh object, which is only compared and handed back.
// That parameter comes out of a list in some callers and is written out at each call in others, where a compiler knows it.
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
const valuesOfOneKind = [
  ["2", "1"],
  ["2", "1"],
  ["2", "1", "0", "-1"],
  ['"ab"', '""'],
  ["{}", "[]", "{ v: 1 }"],
  ["null", "undefined"],
  ["true", "false"],
  ["1.5", "NaN"],
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const failure = typed ? "(error as Error).name" : "error.name";
  const functions: string[] = [];
  const total = random.between(8, 14);
  for (let number = 0; number < total; number++) {
    // The faults of this kind that came from outside were all of one build: a constant, something that may replace it by a fresh object,
    // and a branch that swaps it with the parameter and leaves. Four functions of ten are of that build, with each place drawn.
    const isOfThatBuild = random.chance(0.4);
    const returnsAValue = random.chance(isOfThatBuild ? 0.85 : 0.6);
    const locals = random.chance(0.6) ? ["a", "b"] : ["a", "b", "c"];
    const names = isOfThatBuild ? ["y", "b"] : random.chance(0.5) ? ["y", ...locals.slice(1)] : locals;
    const lone = random.chance(isOfThatBuild ? 0.6 : 0.5) ? "lone" : "";
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
        `${v} === ${w}`,
        `${v} !== ${w}`,
        ...(lone ? [`lone === ${v}`, `lone !== ${v}`, `${v} === lone`, "lone == null"] : []),
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
        `${v} = ${w} === ${u} ? ${w} : 1;`,
        `${v} = ${w} !== ${u} ? ${constant()} : ${w};`,
        ...(returnsAValue ? [] : [`said += typeof ${v} + ",";`]),
      ]);
    };
    const result = () => {
      const [v, w] = different(2);
      return random.pick([
        v,
        v,
        v,
        `${v} === ${w} ? ${v} : 1`,
        `${v} !== ${w} ? ${constant()} : ${w}`,
        ...(lone
          ? [
              `lone === ${v} ? lone : 1`,
              `lone === ${v} ? lone : 1`,
              `lone !== ${v} ? 1 : lone`,
              `${v} === lone ? ${v} : 0`,
              "lone",
            ]
          : []),
        constant(),
      ]);
    };
    const leave = () => (returnsAValue ? `return ${result()};` : `return said + "early " + typeof ${some()};`);
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
        [2, () => `if (${test()}) { ${several(3)} ${leave()} }`],
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
        `if (${v} != ${w}) { [${w}, ${v}] = [${v}, ${w}]; ${random.chance(0.4) ? `${v} = +${v}; ` : ""}${leave()} }`,
        `if (${v} != ${w}) { [${w}, ${v}] = [${v}, ${w}]; ${leave()} }`,
        `if (${test()}) { [${v}, ${w}] = [${w}, ${v}]; ${simple()} } else { ${simple()} }`,
        `{ const held = [${v}, ${w}]; ${w} = held[0]; ${v} = held[1]; }`,
        ...(returnsAValue ? [] : [`said += typeof ${v} + ",";`]),
      ]);
      const parts = (random.chance(0.5) ? [enters, meets, reads] : [meets, enters, reads]).filter(() =>
        random.chance(0.8),
      );
      return (parts.length ? parts : [reads]).join("\n  ");
    };
    const ofThatBuild = () =>
      [
        random.pick([
          `while (b !== b) b = ${fresh("b", "y")};`,
          `while (b !== b) b = ${fresh("b", "y")};`,
          "while (b !== b) b = [b];",
          `if (${random.pick(["z", "!z", "turns"])}) b = ${fresh("b", "y")};`,
          `for (let k = 0; k < turns; k++) b = ${fresh("b", "y")};`,
          "",
        ]),
        `if (${random.pick(["y != b", "y != b", "y != b", "y !== b", "y == b", "b == null", "typeof y !== typeof b", "z"])}) {`,
        "  " +
          random.pick([
            "[b, y] = [y, b];",
            "[b, y] = [y, b];",
            "[b, y] = [y, b];",
            "({ p: b, q: y } = { p: y, q: b });",
            "{ const held = [y, b]; b = held[0]; y = held[1]; }",
            `[b, y] = [y, ${constant()}];`,
          ]),
        ...(random.chance(0.3) ? ["  " + random.pick(["y = +y;", "b = +b;", simple()])] : []),
        "  " + leave(),
        "}",
      ]
        .filter(Boolean)
        .join("\n  ");
    const body = isOfThatBuild
      ? ofThatBuild()
      : Array.from({ length: random.between(1, 5) }, () => (random.chance(0.55) ? motif() : statement())).join("\n  ");
    const last = returnsAValue
      ? random.pick([
          "{ v: 1.5 }",
          "{ v: 1.5 }",
          "[1.5]",
          "[true]",
          "{ v: y }",
          "0",
          "1",
          constant(),
          result(),
          result(),
        ])
      : `said + [${[...names, ...(body.includes("rest") ? ["rest.length"] : [])].join(", ")}].map(describe).join(" ")${lone && ' + " " + typeof lone'}`;
    const isCalledWithEveryKind = random.chance(isOfThatBuild ? 0.3 : 0.5);
    const others = isCalledWithEveryKind
      ? ["null", "true", "value"]
      : random.pick([["0", "2"], ["0", "2"], ["0", "2"], ["value"], ["null", "value"]]);
    const writesTheOthersOut = random.chance(isOfThatBuild ? 0.7 : 0.4);
    const called = (other: string) => {
      const call = `go${number}(value, ${other}, lines.length % 3)`;
      return `lines.push(${returnsAValue ? `describe(${call})` : call});`;
    };
    const start = constant();
    functions.push(`function go${number}(y${as("any")}, z${as("any")}, turns${as("number")})${as(returnsAValue ? "any" : "string")} {
  ${[
    `let ${names
      .filter(name => name !== "y")
      .map(name => `${name}${as("any")} = ${isOfThatBuild ? start : random.pick(starts)}`)
      .join(", ")};`,
    ...(lone
      ? [
          `let lone${as("any")} = ${random.chance(0.6) ? start : constant()}; if (${random.pick(["z", "z", "!z", "turns", "y"])}) lone = ${random.pick(["{ k: 1.5 }", "{ k: 1.5 }", "{ k: 1.5 }", "{ k: y }", "{ k: y }", "[1.5]", "[y]"])};`,
        ]
      : []),
    ...(body.includes("rest") ? [`let rest${as("any[]")} = [];`] : []),
    ...(returnsAValue ? [] : ['let said = "";']),
    ...(body.includes("spins") ? ["let spins = 0;"] : []),
  ].join("\n  ")}
  ${body}
  return ${last};
}
{
  const lines${as("string[]")} = [];
  for (const value of ${isCalledWithEveryKind ? "values" : `[${random.pick(valuesOfOneKind).join(", ")}]`})
    ${writesTheOthersOut ? "" : `for (const other of [${others.join(", ")}]) `}{
      try {
        ${writesTheOthersOut ? others.map(called).join("\n        ") : called("other")}
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
