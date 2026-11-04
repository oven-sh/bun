// emitted.cjs has the mark of an ES module and a default of its own. It stores one name again in a job, and another name only there, so its text does not say all the names it ends with. Nothing but the star asks for its names.
import { count, flag } from "./through-a-star.mjs";

console.log(count, flag);
setTimeout(() => console.log(count, flag));
