// A reference without type arguments takes the defaults of the type parameters. A default that names a `.d.ts` alias makes the written type `unknown`.
/// <reference path="./helper.d.ts" />
interface Box<T = Id> { value: T }
interface Case<T = string> { value: T }
let a: Box;
let b: Case;
let c: Box<number>;
export {};
