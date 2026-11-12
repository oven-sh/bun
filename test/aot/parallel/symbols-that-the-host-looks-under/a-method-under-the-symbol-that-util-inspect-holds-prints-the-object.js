import { inspect } from "node:util";
const symbols = [Symbol.hasInstance, inspect.custom];
const shelf = { count: 1 };
shelf[symbols[JSON.parse("1")]] = () => "printed by the method";
console.log(shelf);
