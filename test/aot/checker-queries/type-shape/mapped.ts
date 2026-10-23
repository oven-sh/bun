// A resolved mapped type is an object; a generic one is a type variable without a constraint.
interface Config { a: number; b?: string }
let v1: Partial<Config>;
let v2: Record<"a", number>;
function f<T>(x: { [K in keyof T]: T[K] }) {}
export {};
