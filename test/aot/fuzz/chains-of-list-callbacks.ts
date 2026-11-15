// `list.map(f).filter(g).reduce(h, 0)`: each method of such a chain finishes its walk before the next one begins, and makes
// a list of its own. The compiler may run the chain as one loop without the lists between. That shows where the callbacks
// share memory: one reads a variable, a field or an element that a later one stores, one logs the order of the calls, one
// throws halfway, one changes the first list or looks at the list it was handed as its third argument.
import type { Random } from "./random";

/** Links of a chain. Each callback may use `state`, `log`, `list` and its own three parameters. */
const links = [
  ".map(value => value + 1)",
  ".map(value => value * 2)",
  ".map(value => value + state.count)",
  ".map(value => {\n      state.count++;\n      return value;\n    })",
  '.map(value => {\n      log.push("m" + value);\n      return value;\n    })',
  ".map((value, at) => value + at)",
  ".map((value, at, all) => value + all.length)",
  ".map((value, at, all) => value + (all[at + 1] ?? 0))",
  ".map((value, at, all) => {\n      all[at + 1] = 50;\n      return value;\n    })",
  '.map(value => {\n      if (value === stop) throw new RangeError("stopped");\n      return value;\n    })',
  ".map(value => {\n      if (list.length < 8) list.push(9);\n      return value;\n    })",
  ".map(value => ({ value }))\n    .map(item => item.value)",
  ".map(value => {\n      box.last = value;\n      return value;\n    })",
  ".map(value => value + (box.last ?? 0))",
  ".filter(value => value % 2 === 0)",
  ".filter(value => value > state.count)",
  ".filter(value => {\n      state.count += 2;\n      return true;\n    })",
  '.filter(value => {\n      log.push("f" + value);\n      return value !== 3;\n    })',
  ".filter((value, at, all) => at < all.length - 1)",
  ".filter(() => state.count++ % 2 === 0)",
  ".slice(1)",
  ".reverse()",
  ".concat([100])",
  ".flatMap(value => [value, value + state.count])",
  ".sort((a, b) => b - a)",
];

/** Links whose callbacks cannot throw and call nobody: all they do is read or write variables that other links use too. */
const quietLinks = [
  ".map(value => value + shared)",
  ".map(value => (shared = shared + value))",
  ".map(value => value * other)",
  ".map(value => value + state.count)",
  ".map(value => (other = value))",
  ".filter(value => (shared = shared * 5 + 1) > value)",
  ".filter(value => value > shared)",
  ".filter(value => (other += 1) > 2)",
  ".filter(value => state.count++ < 3)",
  ".filter(value => value !== other)",
];
const quietEnds = [
  ".reduce((sum, value) => sum + value + shared, 0)",
  ".reduce((sum, value) => (other = sum + value), 0)",
  ".length",
  ".join()",
  "",
];

/** What ends the chain. */
const ends = [
  ".reduce((sum, value) => sum + value, 0)",
  ".reduce((sum, value) => sum + value + state.count, 0)",
  ".join()",
  ".length",
  ".some(value => value > 5)",
  ".every(value => {\n      state.count++;\n      return value < 90;\n    })",
  ".find(value => value > 2)",
  ".indexOf(4)",
  ".includes(state.count)",
  '.forEach(value => log.push("e" + value))',
  ".at(-1)",
  "",
];

const lists = [
  "[1, 2, 3, 4, 5]",
  "[]",
  "[3]",
  "[1.5, 2.5, 3.5]",
  "[1, , 3, 4]",
  "[5, 4, 3, 2, 1, 0]",
  "Array.from({ length: 7 }, (_, at) => at)",
  "given",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isQuiet = random.chance(0.5);
    const chain = random.sample(isQuiet ? quietLinks : links, random.between(2, isQuiet ? 3 : 4)).join("\n    ");
    const rounds = random.pick([1, 1, 3, 300]);
    scenes.push(`function scene${scene}(given, stop) {
  const state = { count: 0 };
  ${random.chance(0.5) ? "let other = 2;" : "other = 2;"}
  shared = 1;
  const box = {};
  const log = [];
  const list = ${random.pick(lists)};
  const answer = told(() =>
    list
    ${chain}
    ${random.pick(isQuiet ? quietEnds : ends)},
  );
  return [String(answer), state.count, shared, other, box.last, log.join(""), list.join()].join(" | ");
}
{
  let last;
  for (let round = 0; round < ${rounds}; round++) last = noted([${random
    .sample(["-1", "2", "3", "4", "6"], 2)
    .map(stop => `scene${scene}([2, 3, 4, 6], ${stop})`)
    .join(", ")}].join(" || "));
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
let shared = 0;
let other = 0;
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
