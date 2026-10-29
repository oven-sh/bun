import defer * as a from "./a.mjs";
console.log("helper is evaluated");
export const other = a;
export { a as handedOn };
