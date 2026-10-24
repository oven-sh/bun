import { Bare, Grown, Tagged, variadic } from "./esm.js";
import both from "./both.cjs";
import Main from "./assigned.cjs";

console.log(variadic(), variadic(1, 2, 3));
console.log(new Grown().extra());
console.log(new Tagged(1).next(), new Bare(2).n + 1);
console.log(both(), both.extra + 1, Main.helper());
