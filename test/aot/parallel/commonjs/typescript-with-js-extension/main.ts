// TypeScript text in files called .js (--loader .js:ts) is TypeScript in which `require`, `module.exports` and `exports` mean CommonJS.
// Flags: --loader .js:ts
// Reference: bun build --compile
import { describe, measure, Point } from "./shapes.js";
console.log(measure(3, 4), measure(5, 12));
console.log(describe(new Point(1, 2)), describe(new Point(0, 0).scaled(3)));
