// Unions are flat and drop `never`; a type parameter is a member like any other.
type A = "a" | "b";
type B = A | "c";
let v1: "a" | "b";
let v2: B;
let v3: string | boolean;
let v4: number | never;
let v5: string | any;
function f<T>(x: T | undefined) {}
export {};
