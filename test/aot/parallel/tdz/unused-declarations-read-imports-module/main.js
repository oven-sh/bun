// The entry point imports a module that loads others, and each of those declares a binding that nothing reads from an export of the entry point, which has not run yet.
import "./loads.js";
export const number = 1;
export const text = "a";
export const object = {};
export class Base extends Object {}
export function hoisted() {}
export var variable = 1;
console.log("main");
