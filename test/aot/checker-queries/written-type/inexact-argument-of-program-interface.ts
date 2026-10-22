// A member of the program's interface can decide by the type argument, so an argument that names a `.d.ts` alias makes the written type `unknown`. A library type keeps its name and takes the written form of the argument.
/// <reference path="./helper.d.ts" />
interface Field<T> { kind: T extends string ? "text" : "other" }
let a: Field<Id>;
let b: Array<Id>;
let c: Promise<Id>;
let d: Map<string, Id[]>;
let e: Field<string>;
export {};
