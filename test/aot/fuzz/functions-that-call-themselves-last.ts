// A function whose last act is to call itself may be compiled as a loop that stores the new arguments over the parameters.
// That is only the same thing while every call has parameters of its own. Each scene picks how the arguments depend on the
// parameters (swapped, shifted, one computed from the other's old value), how many are handed (fewer, more, a spread), and
// who can tell the calls apart: a closure made in each call, `arguments`, a default that reads an earlier parameter, a rest
// parameter, `this`, a try block around the call, a depth that would overflow the stack if the call were not the last act.
import type { Random } from "./random";

/** Functions named NAME. Each ends, and pushes what it sees to `log` or `kept`. */
const functions = [
  "function NAME(a, b) {\n  return b === 0 ? a : NAME(b, a % b);\n}",
  'function NAME(a, b, n = 6) {\n  return n === 0 ? a + ":" + b : NAME(b, a, n - 1);\n}',
  'function NAME(a, b, n = 5) {\n  return n === 0 ? a + ":" + b : NAME(a + b, a, n - 1);\n}',
  'function NAME(a, b, n = 5) {\n  return n === 0 ? a + ":" + b : NAME(b + 1, a * 2, n - 1);\n}',
  'function NAME(a, b, n = 4) {\n  kept.push(() => a + "/" + b);\n  return n === 0 ? "end" : NAME(b, a + 1, n - 1);\n}',
  'function NAME(a, b, n = 4) {\n  const mine = { a, b };\n  kept.push(() => mine.a + "/" + mine.b + "/" + n);\n  return n === 0 ? "end" : NAME(b, a + 1, n - 1);\n}',
  'function NAME(a, b, n = 4) {\n  log.push(arguments.length + ":" + arguments[0]);\n  return n === 0 ? "end" : NAME(b, a, n - 1);\n}',
  'function NAME(a, b = a + 1, n = 4) {\n  log.push(a + "," + b);\n  return n === 0 ? "end" : NAME(b, undefined, n - 1);\n}',
  'function NAME(n, a, b) {\n  log.push(a + "," + b);\n  return n === 0 ? "end" : NAME(n - 1, b);\n}',
  'function NAME(n, a, b) {\n  log.push(a + "," + b);\n  return n === 0 ? "end" : NAME(n - 1, b, a, "more");\n}',
  'function NAME(n, ...rest) {\n  log.push(rest.join("+"));\n  return n === 0 ? "end" : NAME(n - 1, ...rest.reverse(), n);\n}',
  'function NAME(n, a, b) {\n  log.push(a + "," + b);\n  return n === 0 ? "end" : NAME(...[n - 1, b, a]);\n}',
  'function NAME(n, a, b) {\n  log.push(typeof this + a);\n  return n === 0 ? "end" : NAME.call(n, n - 1, b, a);\n}',
  'function NAME(n, a, b) {\n  try {\n    if (n === 0) throw new RangeError("bottom");\n    return NAME(n - 1, b, a);\n  } catch (error) {\n    log.push(a + "," + b);\n    throw error;\n  }\n}',
  'function NAME(n, a, b) {\n  try {\n    return n === 0 ? a + ":" + b : NAME(n - 1, b, a);\n  } finally {\n    log.push(n);\n  }\n}',
  'function NAME(n, a, b) {\n  if (n === 0) return a + ":" + b;\n  a = a + b;\n  b = a - b;\n  return NAME(n - 1, a, b);\n}',
  'function NAME(n, a, b) {\n  if (n === 0) return a + ":" + b;\n  return n % 2 ? NAME(n - 1, b, a) : NAME(n - 1, a + 1, b);\n}',
  'function NAME(n, a, b) {\n  return n === 0 ? a + ":" + b : n > 3 ? NAME(n - 1, b, a) : 1 + NAME(n - 1, a, b).length;\n}',
  "function NAME(n, sum, step) {\n  return n === 0 ? sum : NAME(n - 1, sum + step, step);\n}",
  'function NAME(n, a, b) {\n  return n === 0 ? a.x + ":" + b.x : NAME(n - 1, b, { x: a.x + 1 });\n}',
  'function NAME(n, a, b) {\n  return n === 0 ? a + ":" + b : NAME(n - 1, String(b) + "x", a);\n}',
  'const NAME = (n, a, b) => (n === 0 ? a + ":" + b : NAME(n - 1, b, a));',
  'function NAME(n, a, b) {\n  const again = NAME;\n  return n === 0 ? a + ":" + b : again(n - 1, b, a);\n}',
  'function NAME(n, a, b) {\n  return n === 0 ? a + ":" + b : OTHER(n - 1, b, a);\n}\nfunction OTHER(n, a, b) {\n  return n === 0 ? "other " + a + ":" + b : NAME(n - 1, a + 1, b);\n}',
  'function NAME(n, [a, b]) {\n  return n === 0 ? a + ":" + b : NAME(n - 1, [b, a + 1]);\n}',
  'function NAME(n, { a, b }) {\n  return n === 0 ? a + ":" + b : NAME(n - 1, { a: b, b: a + 1 });\n}',
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const text = random.pick(functions).replaceAll("NAME", `f${scene}`).replaceAll("OTHER", `g${scene}`);
    const head = text.slice(0, text.indexOf(")"));
    const given = /\[a, b\]/.test(head) ? ["N, [1, 2]", "N, [0.5, 7]"] : /\{ a, b \}/.test(head) ? ["N, { a: 1, b: 2 }", "N, { a: -1, b: 0.5 }"] : /a\.x/.test(text) ? ["N, { x: 1 }, { x: 2 }"] : /^function f\d+\(a, b|^function f\d+\(a,/.test(text) ? ["48, 18", "7, 3", "1, 2", "0.5, 2"] : /\.\.\.rest/.test(head) ? ["N, 1, 2", "N"] : /sum, step/.test(head) ? ["N, 0, 1", "N, 0.5, 2", "DEEP, 0, 1"] : ["N, 1, 2", 'N, "a", "b"', "N, 1.5, 2", "N, 1"]; // prettier-ignore
    const calls = random
      .sample(given, Math.min(given.length, 2))
      .map(
        each =>
          `told(() => f${scene}(${each.replace("N", random.pick(["0", "1", "4", "5", "9"])).replace("DEEP", "200000")}))`,
      );
    scenes.push(`${text}
{
  let last;
  for (let round = 0; round < ${random.pick([1, 1, 3, 100])}; round++) {
    log.length = 0;
    kept.length = 0;
    last = noted([${calls.join(", ")}].join(" | ") + " log " + log.join(";") + " kept " + kept.map(each => each()).join(";"));
  }
  console.log("scene ${scene}", last, counted());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set();
function noted(answer) {
  rounds.add(answer);
  return answer;
}
function counted() {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const log = [];
const kept = [];
function told(ask) {
  try {
    return ask();
  } catch (error) {
    return "threw " + error.name;
  }
}
${scenes.join("\n")}
`;
}
