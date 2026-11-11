// Every shape is one call of a built-in. One operand is a value that the built-in may refuse; behind each of the others stands code
// of the program: a toString, a valueOf, a getter, an iterator, each of which writes down that it ran. The built-in throws at a place
// of its own among the conversions of the others, so the shape prints what ran, in which order, and how the call ended.
export type Shape = { name: string; text: string };

const refused = ["5", "'s'", "null", "undefined", "true", "Symbol('s')", "({})", "1n", "(() => 1)", "-1"];

const watcherOfLength = "({ get length() { told.push('L'); return 0; } })";
const watchers = [
  "({ toString() { told.push('S'); return 'x'; } })",
  "({ valueOf() { told.push('V'); return 1; } })",
  "({ [Symbol.toPrimitive](hint) { told.push('P' + hint); return 1; } })",
  watcherOfLength,
  "({ get value() { told.push('b'); return 1; }, get get() { told.push('g'); }, get enumerable() { told.push('e'); return true; } })",
  "Object.assign(new String('x'), { toString() { told.push('H'); return 'x'; } })",
  "({ [Symbol.iterator]() { told.push('I'); return [][Symbol.iterator](); } })",
  "(class { static toString() { told.push('C'); return 'x'; } })",
  "({ get [Symbol.toStringTag]() { told.push('T'); return 't'; }, toString() { told.push('U'); return 'u'; } })",
];

const methodsThatTakeFunction =
  "every some map filter forEach find findIndex findLast findLastIndex flatMap reduce reduceRight sort toSorted".split(" ");

const ends = [
  "catch { end = 'threw'; }",
  "catch (error) { end = 'threw ' + (error instanceof TypeError) + (error instanceof RangeError); }",
  "catch {} finally { told.push('F'); }",
];

export function shapes(): Shape[] {
  const calls: string[][] = [];
  const nextRefused = () => refused[calls.length % refused.length];
  methodsThatTakeFunction.forEach((method, at) => {
    const callee = `Array.prototype.${method}.call(`;
    for (const other of [watchers[at % watchers.length], watchers[(at + 4) % watchers.length]]) {
      calls.push([callee, watcherOfLength, nextRefused(), other]);
      calls.push([callee, watcherOfLength, other, nextRefused()]);
    }
  });
  for (const holder of ["Object", "Reflect"])
    for (const key of watchers)
      for (const _ of [1, 2, 3]) calls.push([`${holder}.defineProperty(`, "{}", key, nextRefused()]);
  return calls.map(([callee, ...operands], at) => {
    const name = `${callee}${operands.map(operand => operand.match(/push\('(\w+)'/)?.[1] ?? operand).join(", ")})`;
    const body = `{ try { end = 'gave ' + typeof ${callee}${operands.join(", ")}); } ${ends[at % ends.length]} }`;
    return {
      name,
      text: `const told = []; let end = 'none';\n${at % 2 ? `function run() ${body}\nrun();` : body}\nconsole.log(told.join(), end);\n`,
    };
  });
}
