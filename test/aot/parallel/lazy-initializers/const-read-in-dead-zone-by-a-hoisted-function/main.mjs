// The variable is read before its declaration has run, and afterwards.
import { read, seenEarly, peek } from "./m.mjs";
console.log(seenEarly, peek(), read().title.text);
