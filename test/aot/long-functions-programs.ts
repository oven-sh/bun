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

export function writeClassWithStaticFields(fieldCount: number): Program {
  return {
    source: [
      `class Table { ${indexesUpTo(fieldCount)
        .map(index => `static k${index} = ${index};`)
        .join(" ")} }`,
      `console.log(Object.keys(Table).length, Table.k7, Table.k${fieldCount - 1});`,
    ].join("\n"),
    output: `${fieldCount} 7 ${fieldCount - 1}\n`,
  };
}

export function writeMethodsStoredIntoPrototype(methodCount: number): Program {
  return {
    source: [
      "function Table() {}",
      ...indexesUpTo(methodCount).map(index => `Table.prototype.k${index} = function () { return ${index}; };`),
      "const table = new Table();",
      `console.log(Object.keys(Table.prototype).length, table.k7(), table.k${methodCount - 1}());`,
    ].join("\n"),
    output: `${methodCount} 7 ${methodCount - 1}\n`,
  };
}

// Every thousandth call throws.
export function writeTryBlocksInARow(blockCount: number): Program {
  const indexes = indexesUpTo(blockCount);
  return {
    source: [
      'function step(index) { if (index % 1000 === 7) throw new Error("thrown"); return index; }',
      "function run() {",
      "let sum = 0;",
      ...indexes.map(index => `try { sum += step(${index}); } catch { sum -= 1; }`),
      "return sum;",
      "}",
      "console.log(run());",
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => sum + (index % 1000 === 7 ? -1 : index), 0)}\n`,
  };
}

export function writeCasesOfOneSwitch(caseCount: number): Program {
  return {
    source: [
      "function find(key) {",
      "switch (key) {",
      ...indexesUpTo(caseCount).map(index => `case ${index}: return ${index} + 1;`),
      "}",
      "return -1;",
      "}",
      `console.log(find(7), find(${caseCount - 1}), find(-5));`,
    ].join("\n"),
    output: `8 ${caseCount} -1\n`,
  };
}

export function writeOperandsOfOneLogicalChain(operandCount: number): Program {
  return {
    source: [
      "function isListed(key) {",
      "return (",
      ...indexesUpTo(operandCount).map(index => `key === ${index} ||`),
      "false",
      ");",
      "}",
      "console.log(isListed(7), isListed(-1));",
    ].join("\n"),
    output: "true false\n",
  };
}

export function writeParametersOfOneFunction(parameterCount: number): Program {
  const indexes = indexesUpTo(parameterCount);
  return {
    source: [
      `function add(${indexes.map(index => `p${index}`).join(", ")}) { return p7 + p${parameterCount - 1}; }`,
      `console.log(add(${indexes.join(", ")}));`,
    ].join("\n"),
    output: `${7 + parameterCount - 1}\n`,
  };
}

export function writeCountedLoopsInARow(loopCount: number): Program {
  const indexes = indexesUpTo(loopCount);
  return {
    source: [
      "function run() {",
      "let sum = 0;",
      ...indexes.map(index => `for (let step = 0; step < 2; step++) { if (step) break; sum += step + ${index}; }`),
      "return sum;",
      "}",
      "console.log(run());",
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => sum + index, 0)}\n`,
  };
}

export function writeLoopsOverOneArrayInARow(loopCount: number): Program {
  const indexes = indexesUpTo(loopCount);
  return {
    source: [
      "function run(list) {",
      "let sum = 0;",
      ...indexes.map(index => `for (const item of list) sum += item + ${index};`),
      "return sum;",
      "}",
      "console.log(run([1, 2]));",
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => sum + 3 + 2 * index, 0)}\n`,
  };
}

export function writeNewObjectsStoredIntoFields(fieldCount: number): Program {
  return {
    source: [
      "class Point { constructor(x) { this.x = x; } }",
      "class Table { constructor() {",
      ...indexesUpTo(fieldCount).map(index => `this.k${index} = new Point(${index});`),
      "} }",
      "const table = new Table();",
      `console.log(table.k7.x, table.k${fieldCount - 1}.x);`,
    ].join("\n"),
    output: `7 ${fieldCount - 1}\n`,
  };
}

export function writeEntriesPutIntoOneMap(entryCount: number): Program {
  return {
    source: [
      "const map = new Map();",
      ...indexesUpTo(entryCount).map(index => `map.set("k${index}", ${index});`),
      'console.log(map.size, map.get("k7"));',
    ].join("\n"),
    output: `${entryCount} 7\n`,
  };
}

export function writePromisesAwaitedTogether(promiseCount: number): Program {
  return {
    source: [
      "async function answer(x) { return x; }",
      "async function run() {",
      "const all = await Promise.all([",
      ...indexesUpTo(promiseCount).map(index => `answer(${index}),`),
      "]);",
      "return all.length + all[7];",
      "}",
      "run().then(sum => console.log(sum));",
    ].join("\n"),
    output: `${promiseCount + 7}\n`,
  };
}

// No function says what it returns, so the type of each is found through the next, all the way round.
export function writeFunctionsThatCallTheNext(functionCount: number): Program {
  return {
    source: [
      ...indexesUpTo(functionCount).map(
        index => `function f${index}(x) { return x > 0 ? f${(index + 1) % functionCount}(x - 1) + ${index} : 0; }`,
      ),
      "console.log(f0(50));",
    ].join("\n"),
    output: "1225\n",
  };
}

export function writeMethodsThatCallTheNext(methodCount: number): Program {
  return {
    source: [
      "class Ring {",
      ...indexesUpTo(methodCount).map(
        index => `m${index}(x) { return x > 0 ? this.m${(index + 1) % methodCount}(x - 1) + ${index} : 0; }`,
      ),
      "}",
      "console.log(new Ring().m0(50));",
    ].join("\n"),
    output: "1225\n",
  };
}

export function writeConditionalsInsideOneAnother(conditionalCount: number): Program {
  return {
    source: [
      "function find(x) {",
      "return (",
      ...indexesUpTo(conditionalCount).map(index => `x === ${index} ? ${index} + 1 :`),
      "-1",
      ");",
      "}",
      `console.log(find(7), find(${conditionalCount - 1}), find(-5));`,
    ].join("\n"),
    output: `8 ${conditionalCount} -1\n`,
  };
}

export function writePromisesAwaitedTogetherAndWalked(promiseCount: number): Program {
  const indexes = indexesUpTo(promiseCount);
  return {
    source: [
      "async function answer(x) { return x; }",
      "async function run() {",
      "const all = await Promise.all([",
      ...indexes.map(index => `answer(${index}),`),
      "]);",
      "let sum = 0;",
      "for (const value of all) sum += value;",
      "return sum;",
      "}",
      "run().then(sum => console.log(sum));",
    ].join("\n"),
    output: `${indexes.reduce((sum, index) => sum + index, 0)}\n`,
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
