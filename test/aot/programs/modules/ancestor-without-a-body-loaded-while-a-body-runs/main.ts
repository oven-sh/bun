// While the body of a module runs, it requires and imports modules that import it and have nothing to run themselves: they only declare functions and re-export. The compiled loader passes over such a module, so it is not "being evaluated" then. Nothing runs twice, the functions answer, a binding that is not reached yet is in its dead zone, and the promises settle in the same order.
import { lines, nameOfOuter, settled } from "./outer";
lines.push("main runs " + nameOfOuter());
await settled();
console.log(lines.join("\n"));
