// Nothing is known of how the name begins.
import { format } from "node:util";
const name = process.argv[5] ?? "ut";
console.log(format("%s", 1), require(name + "il").stripVTControlCharacters("b"));
