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
