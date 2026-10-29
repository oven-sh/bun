// RUN: lower
// OPTIONS: builtin-modules

// One name is imported and require under another name goes through call and apply.
import { inspect } from "node:util";
const { call } = Function.prototype; const load = require;
const name = process.argv.length > 99 ? "node:fs" : "node:util";
console.log(inspect({ a: 1 }), load.call(undefined, name).format("%s-%d", "a", 1), load.apply(undefined, [name]).isDeepStrictEqual([1], [1]));
