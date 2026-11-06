// Only a call that may be made names the file beside the one that hands on the names, in a package that says nothing is lost without its files. As under `bun build --compile` the file does not run at the start.
// Reference: bun build --compile
import { a as first } from "whole";
import { a as second } from "behind";
import { a as third } from "dead";
export function never() { return [import("whole"), import("behind/beside.js")]; }
if (false) import("dead");
console.log(first(), second(), third());
