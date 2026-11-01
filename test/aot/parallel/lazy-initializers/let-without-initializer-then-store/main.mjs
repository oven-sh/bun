// The variable is read before its declaration has run, and afterwards.
// Alone: what is put off goes by all that the executable holds
import { read, seenEarly } from "./m.mjs";
console.log(seenEarly, read().title.text);
