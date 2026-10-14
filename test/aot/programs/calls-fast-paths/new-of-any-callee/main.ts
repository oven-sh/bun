// `new F(x)` where nothing is known of F, for plain functions, functions with properties of their own, with more parameters than arguments, classes.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
console.log(m.make(m.P, m.Q, 1_000_000), m.make(m.WithStatics, m.P, 1_000_000), m.make(m.Optional, m.K, 1_000_000), m.call(m.fewer, m.fewer2, 5_000_000));
export {};
