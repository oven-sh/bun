// One initializer takes what another variable holds. Whichever variable is read first, each object is made once.
import { readUpper, readBase } from "./m.mjs";
const u = readUpper();
console.log(u.below === readBase(), u.below.title.text, u.own.title.text, readUpper() === u);
