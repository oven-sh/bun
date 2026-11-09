// A function returns a literal such as `{ sum, count }`, and its caller, often the function itself one level up, takes the
// fields and returns a new literal. The compiler may hand the fields back as separate values and make no object. The fields
// are small whole numbers almost always. In each scene they rarely are not: one passes 2^31, becomes a fraction, -0, NaN, a
// string or undefined at some depth. The callers take the result apart, keep it, spread it, print it, list its keys or
// compare two results, so that a missing object, another key order or a number cut short shows.
import type { Random } from "./random";

/** What a level adds to `count`. ODD is the depth at which it is not a small whole number. */
const steps = [
  "1",
  "1",
  "n === ODD ? 2147483647 : 1",
  "n === ODD ? 0.5 : 1",
  "n === ODD ? -2147483648 : -1",
  'n === ODD ? "s" : 1',
  "n === ODD ? undefined : 1",
  "n === ODD ? NaN : 1",
  "n === ODD ? 4294967296 : 2",
  "n === ODD ? { valueOf: () => 3 } : 1",
  "n === ODD ? 1n : 1",
];

/** Functions named NAME that walk down from `n` to 0. STEP is one of the expressions above. */
const walkers = [
  "function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  const { sum, count } = NAME(n - 1);\n  return { sum: sum + n, count: count + (STEP) };\n}",
  "function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  const below = NAME(n - 1);\n  return { sum: below.sum + n, count: below.count + (STEP) };\n}",
  "function NAME(n) {\n  if (n === 0) return { count: 0, sum: 0 };\n  const below = NAME(n - 1);\n  return { sum: below.sum + n, count: below.count + (STEP) };\n}",
  "function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  const below = NAME(n - 1);\n  below.sum += n;\n  below.count += STEP;\n  return below;\n}",
  "function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  return { ...NAME(n - 1), count: STEP };\n}",
  "function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  const below = NAME(n - 1);\n  if (n === ODD) kept.push(below);\n  return { sum: below.sum + n, count: below.count + 1 };\n}",
  "function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  const below = NAME(n - 1);\n  return n === ODD ? { sum: below.sum, count: below.count, odd: true } : { sum: below.sum + n, count: below.count + 1 };\n}",
  "function NAME(n) {\n  return n === 0 ? { sum: 0, count: 0 } : OTHER(n);\n}\nfunction OTHER(n) {\n  const { sum, count } = NAME(n - 1);\n  return { sum: sum + n, count: count + (STEP) };\n}",
  "function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  const left = NAME(n - 1);\n  const right = NAME(n >> 1 === n ? 0 : n >> 1);\n  return { sum: left.sum + right.sum, count: left.count + right.count + (STEP) };\n}",
  "function NAME(n) {\n  let result = { sum: 0, count: 0 };\n  for (let i = 1; i <= n; i++) result = add(result, i, ((n = i), STEP));\n  return result;\n}",
  'function NAME(n) {\n  if (n === 0) return { sum: 0, count: 0 };\n  try {\n    const { sum, count } = NAME(n - 1);\n    if (n === ODD) throw new RangeError("odd");\n    return { sum: sum + n, count: count + 1 };\n  } catch {\n    return { sum: -1, count: -1 };\n  }\n}',
  "function NAME(n) {\n  if (n === 0) return [0, 0];\n  const [sum, count] = NAME(n - 1);\n  return [sum + n, count + (STEP)];\n}",
  "function NAME(n, found = { sum: 0, count: 0 }) {\n  return n === 0 ? found : NAME(n - 1, { sum: found.sum + n, count: found.count + (STEP) });\n}",
];

/** Expressions about `r`, the result of the walk, and `again`, the result of a second walk. */
const looks = [
  'r.sum + ":" + shown(r.count)',
  '(({ sum, count }) => sum + ":" + shown(count))(r)',
  "JSON.stringify(r)",
  "Object.keys(r).join()",
  "Object.keys({ ...r }).join() + shown({ ...r }.count)",
  'typeof r.count + ":" + typeof r.sum',
  '(r === again) + ":" + (shown(r.count) === shown(again.count))',
  "(kept.push(r), kept.length)",
  "((r.count = 5), r.count + Object.keys(r).join())",
  "((r.more = 1), Object.keys(r).join())",
  "(delete r.sum, Object.keys(r).join())",
  'shown(r.count + 1) + ":" + shown(r.count * 2)',
  "Object.getPrototypeOf(r) === Object.prototype || Array.isArray(r)",
  "Object.entries(r).map(([name, value]) => name + shown(value)).join()",
  "unknown(r)",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const odd = random.pick(["-1", "1", "3", "7", "20"]);
    const walker = random
      .pick(walkers)
      .replaceAll("STEP", random.pick(steps))
      .replaceAll("ODD", odd)
      .replaceAll("NAME", `walk${scene}`)
      .replaceAll("OTHER", `other${scene}`);
    const asked = random.sample(looks, random.between(1, 4));
    scenes.push(`${walker}
{
  let last = "";
  for (let round = 0; round < ${random.pick([1, 1, 3, 200])}; round++) {
    kept.length = 0;
    const answers = [];
    for (const depth of [${random.sample(["0", "1", "2", "4", "8", "25"], 3).join(", ")}]) {
      answers.push(
        told(() => {
          const r = walk${scene}(depth);
          const again = walk${scene}(depth);
          return [${asked.join(", ")}].join(";");
        }),
      );
    }
    last = noted(answers.join(" | ") + " kept " + kept.map(each => JSON.stringify(each)).join());
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
const kept = [];
const add = (result, value, step) => ({ sum: result.sum + value, count: result.count + step });
const ways = [r => shown(r.count), r => Object.keys(r).length, r => ((r.seen = true), JSON.stringify(r))];
let turn = 0;
const unknown = r => ways[turn++ % ways.length](r);
function shown(value) {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value + " " + String(value);
}
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
