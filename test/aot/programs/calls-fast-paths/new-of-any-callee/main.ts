// `new F(x)` where `F` is not known statically: plain functions, functions with own properties, with more parameters than arguments, and classes.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
console.log(m.make(m.P, m.Q, 1_000_000), m.make(m.WithStatics, m.P, 1_000_000), m.make(m.Optional, m.K, 1_000_000), m.call(m.fewer, m.fewer2, 5_000_000));
export {};
