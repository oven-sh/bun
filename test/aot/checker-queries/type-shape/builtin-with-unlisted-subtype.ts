// A built-in type is exact while every subtype that a declaration file outside the default library declares is in the list of built-in types. One subtype outside the list makes it a view. bun-types declares such subtypes of `Error`.
/// <reference path="./builtin-with-unlisted-subtype.d.ts" />
let a: Date;
let b: RegExp;
let c: Error;
export {};
