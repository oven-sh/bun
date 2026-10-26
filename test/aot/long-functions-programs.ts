export type Program = { source: string; output: string };

export const indexesUpTo = (count: number) => Array.from({ length: count }, (_, index) => index);

const scramble = (index: number) => (index * 31 + 7) | 0;
export const mix = (sum: number, value: number) => (sum * 33 + value) % 1000000007;

// The `try` block has as many calls as there are locals in front of it, and the `catch` block reads every local.
export function writeLocalsReadInCatch(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const sumOfTry = indexes.reduce((sum, index) => mix(sum, scramble(index)), 1);
  const sumOfCatch = indexes.reduceRight((sum, index) => mix(sum, scramble(index)), sumOfTry);
  return {
    source: [
      `const scramble = ${scramble};`,
      `const mix = ${mix};`,
      "function run(throws) {",
      "let sum = 1;",
      ...indexes.map(index => `const local${index} = scramble(${index});`),
      "try {",
      ...indexes.map(index => `sum = mix(sum, scramble(${index}));`),
      'if (throws) throw new Error("thrown");',
      "} catch {",
      ...indexes.map(index => `sum = mix(sum, local${index});`).reverse(),
      "}",
      "return sum;",
      "}",
      "console.log(run(false), run(true));",
    ].join("\n"),
    output: `${sumOfTry} ${sumOfCatch}\n`,
  };
}

export function writeClassWithMethods(methodCount: number): Program {
  return {
    source: [
      `class Table { ${indexesUpTo(methodCount)
        .map(index => `k${index}() { return ${index}; }`)
        .join(" ")} }`,
      "const table = new Table();",
      `console.log(Object.getOwnPropertyNames(Table.prototype).length, table.k7(), table.k${methodCount - 1}());`,
    ].join("\n"),
    output: `${methodCount + 1} 7 ${methodCount - 1}\n`,
  };
}

// The `try` block stores to every local, the `catch` block reads every local, and the second call throws halfway.
export function writeLocalsStoredInTry(localCount: number): Program {
  const indexes = indexesUpTo(localCount);
  const lastStored = localCount >> 1;
  const sumOfCatch = indexes.reduce((sum, index) => mix(sum, index <= lastStored ? index * 7 + 1 : 0), 1);
  return {
    source: [
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(numbers, throws) {",
      "let sum = 1;",
      ...indexes.map(index => `let local${index} = 0;`),
      "try {",
      ...indexes.map(
        index => `local${index} = numbers[${index}];${index === lastStored ? " if (throws) throw 0;" : ""}`,
      ),
      "} catch {",
      ...indexes.map(index => `sum = mix(sum, local${index});`),
      "}",
      `return mix(sum, local0 + local${localCount - 1});`,
      "}",
      "const numbers = [];",
      `for (let index = 0; index < ${localCount}; index++) numbers.push(index * 7 + 1);`,
      "console.log(run(numbers, false), run(numbers, true));",
    ].join("\n"),
    output: `${mix(1, 1 + (localCount - 1) * 7 + 1)} ${mix(sumOfCatch, 1)}\n`,
  };
}
