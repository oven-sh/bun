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

export function writeClassWithFields(fieldCount: number): Program {
  return {
    source: [
      `class Table { ${indexesUpTo(fieldCount)
        .map(index => `k${index} = ${index};`)
        .join(" ")} }`,
      "const table = new Table();",
      `console.log(Object.keys(table).length, table.k7, table.k${fieldCount - 1});`,
    ].join("\n"),
    output: `${fieldCount} 7 ${fieldCount - 1}\n`,
  };
}

// The `try` block stores to every local, the `catch` block reads every local, and the second call throws halfway.
function writeTryThatStoresToLocals(
  localCount: number,
  element: (number: string) => string,
  member: string,
  isReadBehindTry: (index: number) => boolean,
  initial = "0",
  numberOf = (local: string) => local,
): Program {
  const indexes = indexesUpTo(localCount);
  const readBehindTry = indexes.filter(isReadBehindTry);
  const lastStored = localCount >> 1;
  const resultOfRun = (throws: boolean) => {
    const stored = (index: number) => `(${element(String(index * 7 + 1))})${member}`;
    const local = (index: number): number => eval(numberOf(!throws || index <= lastStored ? stored(index) : initial));
    const sumOfCatch = throws ? indexes.reduce((sum, index) => mix(sum, local(index)), 1) : 1;
    const sumBehindTry = readBehindTry.reduce((sum, index) => mix(sum, local(index)), sumOfCatch);
    return mix(sumBehindTry, local(0) + local(localCount - 1));
  };
  return {
    source: [
      "function mix(sum, value) { return (sum * 33 + value) % 1000000007; }",
      "function run(numbers, throws) {",
      "let sum = 1;",
      ...indexes.map(index => `let local${index} = ${initial};`),
      "try {",
      ...indexes.map(
        index => `local${index} = numbers[${index}]${member};${index === lastStored ? " if (throws) throw 0;" : ""}`,
      ),
      "} catch {",
      ...indexes.map(index => `sum = mix(sum, ${numberOf(`local${index}`)});`),
      "}",
      ...readBehindTry.map(index => `sum = mix(sum, ${numberOf(`local${index}`)});`),
      `return mix(sum, ${numberOf("local0")} + ${numberOf(`local${localCount - 1}`)});`,
      "}",
      "const numbers = [];",
      `for (let index = 0; index < ${localCount}; index++) numbers.push(${element("index * 7 + 1")});`,
      "console.log(run(numbers, false), run(numbers, true));",
    ].join("\n"),
    output: `${resultOfRun(false)} ${resultOfRun(true)}\n`,
  };
}

export const writeLocalsStoredInTry = (localCount: number) =>
  writeTryThatStoresToLocals(
    localCount,
    number => number,
    "",
    () => false,
  );

// What is stored is a field of an object, and every seventh local is read once more behind the `try` statement.
export const writeFieldsStoredInTry = (localCount: number) =>
  writeTryThatStoresToLocals(
    localCount,
    number => `{ value: ${number} }`,
    ".value",
    index => index % 7 === 0,
  );

// What is stored is a string, and what is read of it are its length and its last character.
export const writeStringsStoredInTry = (localCount: number) =>
  writeTryThatStoresToLocals(
    localCount,
    number => `"s" + (${number})`,
    "",
    index => index % 7 === 0,
    '"0"',
    local => `${local}.length * 131 + ${local}.charCodeAt(${local}.length - 1)`,
  );
