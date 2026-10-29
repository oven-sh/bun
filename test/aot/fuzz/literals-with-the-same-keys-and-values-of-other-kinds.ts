// Object literals in many places of one program that have the same keys in the same order, and values of other kinds in each place.
//
//   values      whole numbers, fractions, `-0`, `NaN`, texts, booleans, `null`, `undefined`, a field that is missing, a parameter nobody hands in, lists with and without `undefined` in them, other
//               literals, functions, symbols, big integers, dates, what a call answers with
//   places      at the top of the file, in functions that are called once, several times and with other kinds of arguments, in arrows, in loops, as an argument, as a member of another literal
//   handed to   `JSON.stringify` with and without a replacer and an indent, `Object.keys`, `values`, `entries` and `assign`, a spread, a pattern with a rest, `for .. in`, `in`, `Object.hasOwn`,
//               `structuredClone`, `Object.freeze`, `Bun.inspect`, a function that reads the fields, a function nobody knows
//   read        what each of them answers, for every literal
import type { Random } from "./random";

const head = `const lines = [];
function show(value, depth = 0) {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (value === null || typeof value !== "object") return Object.is(value, -0) ? "-0" : String(value);
  if (depth > 3) return "..";
  if (value instanceof Date) return "Date " + value.getTime();
  if (Array.isArray(value)) return "[" + Array.from(value, (each, at) => (at in value ? show(each, depth + 1) : "hole")).join(",") + "]";
  return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + show(value[key], depth + 1)).join(",") + "}";
}
function note(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : show(part))).join(" "));
}
function attempt(label, run) {
  try {
    note(label, "=", run());
  } catch (error) {
    note(label, "THROWS", error.constructor.name);
  }
}
const unknown = [value => value][0];
const mark = Symbol("mark");
function reads(given) {
  return [given.a, given.b, given.c, typeof given.a, typeof given.b];
}
`;

export function generate(random: Random): string {
  const shapes = [["a", "b"], ["a", "b"], ["a", "b", "c"], ["b", "a"], ["a"], ["a", "b", "c", "d"]];
  const keys = random.pick(shapes);
  let count = 0;
  const value = (depth: number): string =>
    random.weighted<() => string>([
      [3, () => random.pick(["1", "2", "0", "-1", "2 ** 31", "7"])],
      [2, () => random.pick(["1.5", "-0", "NaN", "Infinity", "0.1"])],
      [3, () => random.pick(['"text"', '""', '"1"', "`t${1}`"])],
      [1, () => random.pick(["true", "false"])],
      [2, () => "null"],
      [3, () => "undefined"],
      [4, () => random.pick(["o.x", "o.x", "o.y", "o.missing", "o?.x"])],
      [2, () => random.pick(["given", "void 0", "[][0]", "unknown(undefined)", "unknown(1)", 'unknown("u")'])],
      [
        3,
        () =>
          `[${Array.from({ length: random.between(0, 3) }, () => (depth > 0 ? value(depth - 1) : "1")).join(", ")}]`,
      ],
      [depth > 0 ? 3 : 0, () => literal(depth - 1, random.pick(shapes))],
      [
        1,
        () => random.pick(["() => 1", "function () {}", "mark", "Symbol()", "new Date(0)", "/x/", "new Map()", "1n"]),
      ],
    ])();
  const literal = (depth: number, names: string[]): string =>
    `{ ${names.map(name => `${name}: ${value(depth)}`).join(", ")} }`;

  const consume = (text: string): string =>
    random.weighted([
      [8, `JSON.stringify(${text})`],
      [1, `JSON.stringify(${text}, null, 1)`],
      [1, `JSON.stringify(${text}, (key, each) => (each === undefined ? "nothing" : each))`],
      [1, `JSON.stringify(${text}, ["a", "c"])`],
      [1, `JSON.stringify([${text}, ${text}])`],
      [1, `JSON.parse(JSON.stringify(${text}))`],
      [2, `Object.keys(${text})`],
      [2, `Object.values(${text})`],
      [2, `Object.entries(${text})`],
      [1, `Object.assign({ z: 0 }, ${text})`],
      [2, `{ ...${text} }`],
      [1, `{ z: 0, ...${text}, a: "over" }`],
      [1, `(({ a, ...rest }) => [a, rest])(${text})`],
      [
        1,
        `(held => {\nconst names = [];\nfor (const name in held) names.push(name, held[name]);\nreturn names;\n})(${text})`,
      ],
      [1, `["a", "b", "c"].map(name => name in ${text.startsWith("{") ? `(${text})` : text})`],
      [1, `Object.hasOwn(${text}, "b")`],
      [1, `structuredClone(${text})`],
      [1, `Object.isFrozen(Object.freeze(${text}))`],
      [1, `Bun.inspect(${text})`],
      [2, `reads(${text})`],
      [2, `unknown(${text})`],
      [1, `${text.startsWith("{") ? `(${text})` : text}.b`],
      [1, `Object.getOwnPropertyNames(${text}).length`],
    ]);

  const rows: string[] = [];
  for (let id = 0, scenes = random.between(4, 10); id < scenes; id++) {
    const text = literal(random.between(0, 2), random.chance(0.8) ? keys : random.pick(shapes));
    const used = consume(text);
    const wrapped = used.startsWith("{") ? `(${used})` : used;
    const calls = random.pick([
      [`{ y: 1 }`],
      [`{ y: 1 }`],
      [`{ x: 5, y: 1 }`],
      [`{ y: 1 }`, `{ x: 5, y: 1 }`],
      [`{ x: "text", y: 1 }`, `{ y: 1 }`, `{ x: null }`],
      [`{}`, `{ x: undefined }`],
      [`{ x: [1], y: { a: 1 } }`],
    ]);
    rows.push(
      random.weighted<() => string>([
        [
          6,
          () =>
            `function make${id}(o, given) {\nreturn ${wrapped};\n}\n${calls.map(call => `attempt("make${id}(${call.replaceAll('"', "'")})", () => make${id}(${call}));`).join("\n")}`,
        ],
        [
          2,
          () =>
            `const make${id} = (o, given) => ${wrapped};\n${calls.map(call => `attempt("make${id}(${call.replaceAll('"', "'")})", () => make${id}(${call}));`).join("\n")}`,
        ],
        [2, () => `{\nconst o = ${calls[0]};\nlet given;\nattempt("scene ${id}", () => ${wrapped});\n}`],
        [1, () => `for (const o of [${calls.join(", ")}]) {\nlet given;\nattempt("scene ${id}", () => ${wrapped});\n}`],
        [
          1,
          () =>
            `function make${id}(o, given) {\nconst held = ${text};\nconst first = ${consume("held")
              .replace(/^\{/, "({")
              .replace(/^(\(\{.*\})$/s, "$1)")};\nheld.${random.pick(keys)} = ${value(0)};\nreturn [first, ${consume(
              "held",
            )
              .replace(/^\{/, "({")
              .replace(
                /^(\(\{.*\})$/s,
                "$1)",
              )}];\n}\n${calls.map(call => `attempt("make${id}(${call.replaceAll('"', "'")})", () => make${id}(${call}));`).join("\n")}`,
        ],
      ])(),
    );
    count++;
  }
  return `${head}${rows.join("\n")}\nnote("scenes", ${count});\nconsole.log(lines.join("\\n"));\n`;
}
