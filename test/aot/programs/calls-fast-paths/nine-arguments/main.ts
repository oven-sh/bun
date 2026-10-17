// Calls with nine arguments, to functions with nine parameters, with two, and with a rest parameter.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
console.log(m.run(m.f, m.g, 2_000_000), m.run(m.few, m.few2, 2_000_000), m.run(m.rest, m.rest2, 2_000_000));
export {};
