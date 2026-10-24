// `export = whole`, where `whole` is a constant that holds a literal of other constants.
declare const console: { log(...values: unknown[]): void };
import assigned = require("./assigned");
console.log(assigned.text, assigned.list[0]);
