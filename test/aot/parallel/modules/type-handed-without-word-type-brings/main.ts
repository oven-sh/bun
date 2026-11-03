// Hands on a type of another file without the word `type`: the other file runs, then this one, as in an executable built without --aot.
export { Alias } from "./leaf";
export { Shape as Other } from "./leaf";
console.log("main");
/* Output:
leaf
main
*/
