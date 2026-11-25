// `let b = null; while (b !== b) b = [b]; if (y != b) { [b, y] = [y, b]; return y; }`: a variable is used behind a change that never runs.
// The loop makes no turn, the test never holds, the catch is never reached: a run sees nothing of it, but whoever reasons about the function
// has to take the change for possible, and what it then believes of the variable is neither what stood before nor what the change would
// have left. What varies: what the variable holds, how the change is kept from running, what it would have stored, how the variable is then
// compared with a parameter, whether the two are swapped and how, whether a second variable holds an object under a condition, and what is
// done with the values behind all that.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

export function helpers(typed: boolean): string {
  return `const F = process.argv.length > 99, Z = F ? 1 : 0;
function show(v${typed ? ": unknown" : ""})${typed ? ": string" : ""} {
  return typeof v === "function" ? "function" : v === undefined ? "undefined" : Object.is(v, -0) ? "-0" : JSON.stringify(v);
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const any = typed ? ": any" : "";
  const start = random.weighted([
    [6, "null"],
    [3, "undefined"],
    [1, "0"],
    [1, '""'],
    [1, "false"],
  ] as const);
  const change = random.weighted([
    [5, "[b]"],
    [3, "{ v: b }"],
    [2, "1.5"],
    [1, '"s"'],
    [1, "() => b"],
    [2, "y"],
    [1, "[b, y]"],
  ] as const);
  const never = random.weighted([
    [6, `while (b !== b) b = ${change};`],
    [3, `if (F) b = ${change};`],
    [2, `for (; F; ) b = ${change};`],
    [2, `for (let i = 0; i < Z; i++) b = ${change};`],
    [1, `try { if (F) throw 0; } catch { b = ${change}; }`],
    [1, `switch (Z) { case 1: b = ${change}; }`],
    [1, `F && (b = ${change});`],
    [1, `do { if (!F) break; b = ${change}; } while (F);`],
  ] as const);
  const test = random.weighted([
    [5, "y != b"],
    [3, "y !== b"],
    [1, "!(y == b)"],
    [1, "!(y === b)"],
    [1, "b == null && y != null"],
    [1, "!Object.is(y, b)"],
  ] as const);
  const swap = random.weighted([
    [6, "[b, y] = [y, b];"],
    [2, "const t = b; b = y; y = t;"],
    [1, "({ b, y } = { b: y, y: b });"],
    [1, "y = b;"],
    [1, ""],
  ] as const);
  const hasSecond = random.chance(0.5);
  const made = random.pick(["{ k: 1.5 }", "{ k: 1 }", "[1.5]", "{ k: n }"]);
  const use = random.weighted([
    [3, "return y;"],
    [hasSecond ? 4 : 0, "return c === y ? c : 1;"],
    [hasSecond ? 2 : 0, "return c == y ? 2 : c;"],
    [
      3,
      "let r = y; for (let i = 0; i < n; i++) r = { v: i + 0.5 }; return r === null ? -1 : r === undefined ? -2 : r.v;",
    ],
    [2, "try { return y.v; } catch (e) { return -1; }"],
    [2, "return (y ?? 1) + n + 0.5;"],
    [1, "return [y, b];"],
    [1, "return typeof y + typeof b;"],
    [1, "return y === null ? b : y;"],
  ] as const);
  const otherwise = random.pick(["return { v: 1.5 };", "return 0;", "return b;", "return null;"]);
  const isAhead = random.chance(0.3);
  const second = hasSecond ? `  let c${any} = null; if (n) c = ${made};\n` : "";
  const text = `function ${name}(y${any}, n${typed ? ": number" : ""})${any} {
  let b${any} = ${start};
${isAhead ? "" : second}  ${never}
${isAhead ? second : ""}  if (${test}) {
    ${swap}
    ${use}
  }
  ${otherwise}
}
`;
  const given = random.sample(["2", "1", "null", "undefined", "0", '"s"', "{ v: 3 }", "1.5"], random.between(2, 4));
  const turns = random.sample(["0", "2", "1"], random.between(1, 2));
  return { name, text, calls: given.flatMap(value => turns.map(turn => `show(${name}(${value}, ${turn}))`)) };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(6, 12) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
