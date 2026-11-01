// The first read of the variable comes in a getter, a generator, an async function, a trap, toJSON, a comparator, a catch or a finally.
// Alone: what is put off goes by all that the executable holds
import { inGetter, inGenerator, inAsync, inProxy, inToJSON, inComparator } from "./m.mjs";
console.log(inGetter.v, [...inGenerator()].join(), inProxy.anything, JSON.stringify(inToJSON), [3, 1, 2].sort(inComparator).join(), await inAsync());
