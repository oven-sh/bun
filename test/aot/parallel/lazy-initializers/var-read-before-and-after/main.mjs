// The variable is read before its declaration has run, and afterwards.
// Alone: what is put off goes by all that the executable holds
import { read, seenEarly, early } from "./m.mjs";
console.log(seenEarly, early(), read().title.text);
