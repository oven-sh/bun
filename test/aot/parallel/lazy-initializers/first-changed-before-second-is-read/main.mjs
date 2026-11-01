// One initializer takes what another variable holds. Whichever variable is read first, each object is made once.
// Alone: what is put off goes by all that the executable holds
import { readUpper, readBase } from "./m.mjs";
readBase().title.text = "changed";
readBase().title = { text: "replaced" };
const u = readUpper();
console.log(u.text, u.below.title.text);
