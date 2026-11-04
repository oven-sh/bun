// The variable is read before its declaration has run, and afterwards.
import { read, seenEarly } from "./m.mjs";
console.log(seenEarly, read().title.text);
