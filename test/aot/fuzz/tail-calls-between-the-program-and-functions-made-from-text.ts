// A ring of strict functions that call one another in tail position. Some stand in the program, some are made from text at run time, and some are
// reached through a Proxy without an apply trap. The calls differ in their form and hand over fewer, as many or more arguments than the callee
// names. A ring in which every call is a tail call is walked a hundred thousand times; a ring with one call that is not is walked a few times.
import type { Random } from "./random";

const parameters = [
  `n, sum`,
  `n, sum, extra`,
  `n, sum, ...rest`,
  `n, sum = 0, extra = "d"`,
  `n, sum, a, b, c, d, e, f`,
] as const;
const moreArguments = [``, ``, `, "x"`, `, 1, 2`, `, sum, n, "y", null`, `, 1, 2, 3, 4, 5, 6, 7, 8, 9`] as const;

const tailForms = [
  (next: string, given: string) => `return table.${next}(${given});`,
  (next: string, given: string) => `return (0, table.${next})(${given});`,
  (next: string, given: string) => `const callee = table.${next};\nreturn callee(${given});`,
  (next: string, given: string) => `return table.${next}.call(undefined, ${given});`,
  (next: string, given: string) => `return table.${next}.apply(table, [${given}]);`,
  (next: string, given: string) => `return table.${next}(...[${given}]);`,
  (next: string, given: string) => `return n & 1 ? table.${next}(${given}) : (0, table.${next})(${given});`,
  (next: string, given: string) => `return (sum |= 0), table.${next}(${given});`,
  (next: string, given: string) => `return n > 0 && table.${next}(${given});`,
  (next: string, given: string) => `if (n & 2) return table.${next}(${given});\nreturn table["${next}"](${given});`,
] as const;

const otherForms = [
  (next: string, given: string) => `const result = table.${next}(${given});\nreturn result;`,
  (next: string, given: string) => `try {\nreturn table.${next}(${given});\n} finally {\nsum++;\n}`,
  (next: string, given: string) => `return "" + table.${next}(${given});`,
  (next: string, given: string) => `return Reflect.apply(table.${next}, undefined, [${given}]);`,
  (next: string, given: string) => `return table.${next}.bind(undefined)(${given});`,
  (next: string, given: string) => `return [0].map(() => table.${next}(${given}))[0];`,
] as const;

const ends = [
  `return sum + ":" + arguments.length;`,
  `return sum;`,
  `throw new Error("the end " + sum);`,
  `return { sum, count: arguments.length };`,
  `return new Error("made at the end").message + sum;`,
] as const;

const work = [
  ``,
  ``,
  `sum = (sum * 31 + n) | 0;`,
  `sum += [n, n + 1].length;`,
  `sum += { n }.n & 3;`,
  `if (n % 5000 === 0) Bun.gc(true);`,
] as const;

export function generate(random: Random): string {
  const count = random.between(2, 7);
  const isAllTailCalls = random.chance(0.7);
  const odd = isAllTailCalls ? -1 : random.below(count);
  const lines = [`const table = {};`, `globalThis.table = table;`];
  for (let index = 0; index < count; index++) {
    const name = `step${index}`;
    const next = `step${(index + 1) % count}`;
    const given = `n - 1, sum + ${index}${random.pick(moreArguments)}`;
    const call = random.pick(index === odd ? otherForms : tailForms)(next, given);
    const body = `if (n <= 0) {\n${random.pick(ends)}\n}\n${random.pick(work)}\n${call}`;
    const text = `function ${name}(${random.pick(parameters)}) {\n${body}\n}`;
    const strictText = JSON.stringify(`"use strict";\nreturn ${text};`);
    lines.push(
      random.pick([
        `table.${name} = ${text};`,
        `table.${name} = ${text};`,
        `table.${name} = new Function("table", ${strictText})(table);`,
        `table.${name} = new Function(${strictText})();`,
        `table.${name} = (0, eval)(${JSON.stringify(`"use strict";\n(${text});`)});`,
      ]),
    );
    if (random.chance(0.2)) lines.push(`table.${name} = new Proxy(table.${name}, {});`);
    if (random.chance(0.05)) lines.push(`table.${name} = new Proxy(new Proxy(table.${name}, {}), {});`);
  }
  const lengths = isAllTailCalls ? [0, 1, 2, count, 150, 100_000] : [0, 1, 2, count, 60];
  return `${lines.join("\n")}
function show(value) {
  return value !== null && typeof value === "object" ? JSON.stringify(value) : String(value);
}
function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "throws", error.name, error.message);
  }
}
const enterFromText = new Function("table", "n", '"use strict";\\nreturn table.step0(n, 0);');
const enterFromTextAndGoOn = new Function("table", "n", '"use strict";\\nconst result = table.step${random.below(count)}(n, 1, "z");\\nreturn result;');
for (let time = 0; time < ${random.weighted([
    [4, 1],
    [1, 3],
  ] as const)}; time++) {
  for (const length of [${lengths.join(", ")}]) {
    attempt("from the program " + length, () => table.step0(length, 0));
    attempt("in tail position " + length, () => {
      "use strict";
      return table.step${random.below(count)}(length, 2, "w", 3);
    });
    attempt("from text " + length, () => enterFromText(table, length));
    attempt("from text that goes on " + length, () => enterFromTextAndGoOn(table, length));
  }
}
`;
}
