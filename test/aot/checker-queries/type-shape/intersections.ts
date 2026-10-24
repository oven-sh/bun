// A primitive wins an intersection, `void` as `undefined`: a brand is a phantom that no value has. Object parts merge. A type parameter makes it a type variable whose constraint is the other parts. A union among several object parts makes it a type variable without a constraint.
let v1: string & { __brand: "id" };
let v2: { a: number } & { b: string };
let v3: (() => void) & { x: number };
let v4: string & number;
function f<T>(x: T & {}) {}
interface A { a: number }
interface B { b: number }
let v5: NoInfer<string | A> & B;
let v6: void & { __brand: void };
let v7: number & { __tag: "id" };
let v8: "a" & { __brand: 1 };
let v9: symbol & { __brand: 1 } & { __other: 2 };
export {};
