// The first read of the variable comes in a getter, a generator, an async function, a trap, toJSON, a comparator, a catch or a finally.
import { run } from "./m.mjs";
console.log(run());
