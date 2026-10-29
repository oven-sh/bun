// Two files have types with the same names: in one the members are int32, in the other numbers. No object of the one is taken for the other, and each file reads what its own types say.
import { fractions } from "./fractions.ts";
import { wholeNumbers } from "./whole-numbers.ts";
console.log(await wholeNumbers(), fractions());
