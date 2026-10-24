// Modules that import each other see each other half evaluated.
import { a, readB } from "./a";
import { b, readA } from "./b";
console.log(JSON.stringify([a, b, readA(), readB()]));
