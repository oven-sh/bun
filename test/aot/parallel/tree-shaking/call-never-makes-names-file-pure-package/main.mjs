// The files that import are loaded by statements. A call of import() that nothing ever makes names the file of the first package that hands on the names, a file behind it in the second, and is dead code in the third. `bun build --compile` makes a function of what such a call names, so the import by a statement calls it in the first package alone.
// Reference: bun build --compile
import { a as first } from "whole";
import { a as second } from "behind";
import { a as third } from "dead";
function never() { return [import("whole"), import("behind/beside.js")]; }
if (false) import("dead");
console.log(first(), second(), third());
