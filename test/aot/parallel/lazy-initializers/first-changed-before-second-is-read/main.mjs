// One initializer takes what another variable holds. Whichever variable is read first, each object is made once.
import { readUpper, readBase } from "./m.mjs";
readBase().title.text = "changed";
readBase().title = { text: "replaced" };
const u = readUpper();
console.log(u.text, u.below.title.text);
