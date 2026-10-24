// Species: programs w static name getter util inspect. It prints what plain Bun prints.
import { inspect } from "node:util";
let reads = 0;
class Named { static get name(): string { reads++; return "Custom"; } }
console.log(inspect(new Named()), reads > 0);
