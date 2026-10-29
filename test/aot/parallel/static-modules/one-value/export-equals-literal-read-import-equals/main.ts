// `export = { .. }` read through `import x = require()`: a member that is read further, and one that is called. Each name of the literal is a variable, and the file has no object.
// STATISTIC: ModulesWithNames >= 2
declare const console: { log(...values: unknown[]): void };
import literal = require("./literal");
import table = require("./table");
console.log(literal.a, literal.list.length, literal.list[1]);
console.log(table.entry(), table.renamed());
