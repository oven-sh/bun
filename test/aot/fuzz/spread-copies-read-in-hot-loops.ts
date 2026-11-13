// `const copy = { ...source, b: i }` in a loop that runs often, where the copy is only read: the compiler need not make the
// object while the source has the shape it expects. Each scene runs such a loop, and in a few turns the source is something
// else: other keys or another order, a getter that counts, a proxy, a list, a string, null, symbols, hidden members. In some
// turns the copy is also kept, returned, listed, changed or compared, or the source changes after the copy was made. Every
// distinct answer of the loop is printed, and what was kept.
import type { Random } from "./random";

/** The usual source. */
const usual = [
  "{ a: 1, b: 2 }",
  "{ a: 1, b: 2, c: 3 }",
  '{ a: 1.5, b: "text" }',
  "new Pair(1, 2)",
  "{ a: i, b: i + 1 }",
  "{ a: { deep: 1 }, b: 2 }",
];

/** What comes in its place in a rare turn. */
const rare = [
  "{ b: 2, a: 1 }",
  "{ a: 1, b: 2, extra: 3 }",
  "{ a: 1 }",
  "{}",
  '{ a: 1, get b() {\n        log.push("getter");\n        return 20;\n      } }',
  '{ get a() {\n        throw new RangeError("getter throws");\n      }, b: 2 }',
  'new Proxy({ a: 1, b: 2 }, { ownKeys: target => (log.push("ownKeys"), Reflect.ownKeys(target)) })',
  'new Proxy({ a: 1, b: 2 }, { get: (target, name) => (log.push("get " + String(name)), 9) })',
  "[7, 8]",
  '"st"',
  "null",
  "undefined",
  "5",
  '{ a: 1, b: 2, [Symbol.for("s")]: 3 }',
  'Object.defineProperty({ a: 1, b: 2 }, "hidden", { value: 3, enumerable: false })',
  'Object.defineProperty({ b: 2 }, "a", { value: 1, enumerable: false })',
  'Object.create({ a: "inherited" }, { b: { value: 2, enumerable: true } })',
  '{ a: 1, b: 2, 1: "one", 0: "zero" }',
  '{ a: 1, b: 2, ["__proto__"]: { c: 3 } }',
  "Object.freeze({ a: 1, b: 2 })",
  "new Below(1, 2)",
  '{ a: "text", b: 2.5 }',
  "{ a: undefined, b: null }",
];

/** Expressions that make the copy out of `source`. */
const copies = [
  "{ ...source, b: i }",
  "{ ...source, b: i }",
  "{ b: i, ...source }",
  "{ ...source }",
  "{ ...source, c: i }",
  "{ ...source, ...other }",
  "{ ...{ ...source, a: 5 }, b: i }",
  "{ first: 0, ...source, b: i, last: 1 }",
  "Object.assign({}, source, { b: i })",
  "{ ...source, [name]: i }",
  "(({ a, ...rest }) => rest)(source ?? {})",
];

/** Statements that read `copy` and add to `line`. */
const reads = [
  'line += copy.a + "," + copy.b;',
  'line += copy.a + "," + copy.b;',
  "line += copy.b;",
  'line += copy.a + "," + copy.c + "," + copy.extra;',
  'line += ("a" in copy) + "," + ("extra" in copy);',
  "line += typeof copy.a + typeof copy.b;",
  "line += copy.a?.deep;",
  'copy.a = 100;\n    line += copy.a + "," + source?.a;',
  'if (source && typeof source === "object" && !Object.isFrozen(source)) source.a = 200;\n    line += copy.a;',
  "if (isRare) kept.push(copy);\n    line += copy.b;",
  "if (isRare) line += Object.keys(copy).join();\n    line += copy.b;",
  "if (isRare) line += JSON.stringify(copy);\n    line += copy.a;",
  "if (i === turns - 1) kept.push(copy);\n    line += copy.a;",
  "line += copy === source;",
  "if (isRare) line += unknown(copy);\n    line += copy.b;",
  'const { a, b = "none" } = copy;\n    line += a + "," + b;',
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(2, 5); scene < total; scene++) {
    const turns = random.pick([3, 300, 3000, 20000]);
    const when = random.pick(["i === turns - 1", "i === 1", "i % 97 === 5", "i === turns >> 1", "false"]);
    scenes.push(`function scene${scene}(turns, other, name) {
  const answers = new Set();
  for (let i = 0; i < turns; i++) {
    const isRare = ${when};
    let line = "";
    try {
      const source = isRare ? ${random.pick(rare)} : ${random.pick(usual)};
      const copy = ${random.pick(copies)};
      ${random.sample(reads, random.between(1, 2)).join("\n    ").replaceAll("\n", "\n  ")}
    } catch (error) {
      line += "threw " + error.name;
    }
    // The turn's number is taken out, so that the usual turns give one answer.
    answers.add(line.replaceAll(String(i), "i"));
  }
  return [...answers].slice(0, 6).join(" | ");
}
console.log("scene ${scene}", scene${scene}(${turns}, ${random.pick(["{ b: 7 }", "{ z: 7 }", "{}", "null"])}, ${random.pick(['"b"', '"a"', '"fresh"', "0"])}), "kept", kept.splice(0).map(each => JSON.stringify(each)).join(), "log", log.length, log.splice(0).slice(0, 4).join());`);
  }
  return `const kept = [];
const log = [];
class Pair {
  constructor(a, b) {
    this.a = a;
    this.b = b;
  }
  get c() {
    return "accessor of the class";
  }
}
class Below extends Pair {
  extra = "field";
}
const ways = [copy => Object.keys(copy).length, copy => ((copy.seen = true), JSON.stringify(copy)), copy => copy.a];
let turn = 0;
const unknown = copy => ways[turn++ % ways.length](copy);
${scenes.join("\n")}
`;
}
