// `===`, `==`, `!`, truthiness and `== null` on constants are folded once inlining has made the constants visible.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
console.log(m.all().join());
console.log(m.watched(), m.given("x", "x"), m.given("y", null), m.given(0, undefined), m.given(null, 0), m.given({ valueOf() { return "x"; } }, "x"));
export {};
