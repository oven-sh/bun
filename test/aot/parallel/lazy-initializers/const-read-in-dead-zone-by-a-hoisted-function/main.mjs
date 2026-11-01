// The variable is read before its declaration has run, and afterwards.
// Alone: what is put off goes by all that the executable holds
import { read, seenEarly, peek } from "./m.mjs";
console.log(seenEarly, peek(), read().title.text);
