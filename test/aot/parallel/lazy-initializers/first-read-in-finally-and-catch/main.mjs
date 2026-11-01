// The first read of the variable comes in a getter, a generator, an async function, a trap, toJSON, a comparator, a catch or a finally.
// Alone: what is put off goes by all that the executable holds
import { run } from "./m.mjs";
console.log(run());
