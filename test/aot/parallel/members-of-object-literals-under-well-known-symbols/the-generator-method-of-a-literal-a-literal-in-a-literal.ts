// A member of an object literal under a well-known symbol: the generator method of a literal a literal in a literal.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
const outer = { rows: [[1, 2], [3]], *[Symbol.iterator]() { for (const row of this.rows) yield { row, *[Symbol.iterator]() { for (const x of this.row) yield x * 2; } }; } };
let s = 0; for (const inner of outer) for (const x of inner) s += x; console.log(s);
