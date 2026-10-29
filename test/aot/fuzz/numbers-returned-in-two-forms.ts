// Functions return numbers: some always whole ones, some fractions, some either, some a number or null or undefined. They
// call each other in tail position, through a table, as methods of several classes under one name, as callbacks of
// built-ins, out of try and finally, and recursively. The compiler may return such a number in a register, as an integer or
// as a double, and every caller must read it in the form the callee really used. Values at the edges are passed through:
// -0, NaN, 2^31, 2^53, 0.5, and a value that is no number where the type lies.
import type { Random } from "./random";

/** Bodies of a function of `x`. CALL(..) calls another function of the scene. */
const bodies = [
  "return x | 0;",
  "return x * 0.5;",
  "return x > 0 ? x * 0.5 : x | 0;",
  "return x > 0 ? 1 : 0.5;",
  "return CALL(x);",
  "return x > 1 ? CALL(x - 1) : x;",
  "return x > 0 ? x * 0.5 : CALL(x);",
  "return CALL(x) + 1;",
  "return -CALL(x);",
  "return CALL(CALL(x));",
  "try {\n    return CALL(x);\n  } finally {\n    depth--;\n  }",
  'try {\n    if (x === 3) throw new Error("three");\n    return CALL(x);\n  } catch {\n    return 0.25;\n  }',
  "switch (x & 3) {\n    case 0:\n      return 1;\n    case 1:\n      return 1.5;\n    case 2:\n      return CALL(x);\n    default:\n      return -0;\n  }",
  "return Math.round(x);",
  "return x % 2;",
  "return x / 2;",
  "return x * x;",
  "return x + 2147483647;",
  "return Math.max(CALL(x), 0.5);",
  "return [x, CALL(x)][1];",
  "let sum = 0;\n  for (let i = 0; i < 3; i++) sum += CALL(x + i);\n  return sum;",
];

/** Bodies whose result may be absent. */
const optional = [
  "return x > 0 ? x : null;",
  "return x > 0 ? x * 0.5 : undefined;",
  "return x === 2 ? null : CALL(x);",
  "if (x > 1) return x;",
];

/** Expressions that call the functions of the scene with `v`. FIRST is one of them. */
const callers = [
  "FIRST(v)",
  "FIRST(v) + 0",
  "FIRST(v) | 0",
  "table[i % table.length](v)",
  "[v].map(FIRST)[0]",
  "[v, v].reduce((sum, each) => sum + FIRST(each), 0)",
  "things[i % things.length].value(v)",
  "Reflect.apply(FIRST, null, [v])",
  "FIRST.call(null, v)",
  "Object.is(FIRST(v), -0)",
  "FIRST(v) === FIRST(v)",
  "String(FIRST(v))",
  "[3, 1, 2].sort((a, b) => FIRST(a) - FIRST(b)).join()",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(1, 3); scene < total; scene++) {
    const count = random.between(3, 6);
    const name = (at: number) => `f${scene}_${at}`;
    // The last function calls nobody and always returns a number.
    const isOptional = Array.from({ length: count }, (_, at) => at < count - 1 && random.chance(0.15));
    const functions = isOptional.map((optionalResult, at) => {
      // A function only calls those after it, so that every chain of calls ends. TypeScript does not let a result that may
      // be absent stand where a number is wanted.
      const later = isOptional.flatMap((each, other) => (other > at && !(typed && each) ? [other] : []));
      const pool = (optionalResult ? optional : bodies).filter(body => later.length || !body.includes("CALL"));
      const body = random.pick(pool).replaceAll("CALL", () => name(random.pick(later)));
      return `function ${name(at)}(x${as("number")})${as(optionalResult ? "number | null | undefined" : "number")} {\n  ${body}\n}`;
    });
    const plain = isOptional.flatMap((each, at) => (each ? [] : [name(at)]));
    const used = random
      .sample(callers, random.between(2, 5))
      .map(caller => caller.replaceAll("FIRST", () => random.pick(plain)));
    scenes.push(`${functions.join("\n")}
{
  const table = [${plain.join(", ")}];
  const things = [${plain.map(each => `new (class {\n    value(x${as("number")})${as("number")} {\n      return ${each}(x);\n    }\n  })()`).join(", ")}];
  const answers${as("unknown[]")} = [];
  for (let i = 0; i < edges.length * ${random.pick([1, 1, 40])}; i++) {
    const v = edges[i % edges.length];
    const round = [${used.map(use => `told(() => ${use})`).join(", ")}];
    if (i < edges.length) answers.push(round.map(shown).join(","));
  }
  console.log("scene ${scene}", answers.join(" | "));
}`);
  }
  return `let depth = 0;
const edges${as("number[]")} = [0, 1, 2, 3, -1, -0, 0.5, 2147483647, 2147483648, -2147483648, 9007199254740991, NaN, Infinity${typed ? ', "5" as unknown as number' : ', "5"'}];
function shown(value${as("unknown")})${as("string")} {
  return Object.is(value, -0) ? "-0" : String(value);
}
function told(ask${as("() => unknown")})${as("unknown")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
console.log("depth", depth);
`;
}
