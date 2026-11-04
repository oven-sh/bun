// The variable is read before its declaration has run, and afterwards.
import { read, seenEarly, early } from "./m.mjs";
console.log(seenEarly, early(), read().title.text);
