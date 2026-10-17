// An ES module is required while it is being evaluated: nothing is evaluated twice, function declarations answer, and a `const` that has not been reached is in its dead zone, for a member, for a pattern and for a constant that holds the module.
import { seen } from "./first";
console.log(seen.join("\n"));
