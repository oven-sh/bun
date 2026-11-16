// A text that is only asked for its length in its own file is still there for the files that import it, and for the namespace object.
import { FIRST, both, lengths } from "./texts";
import * as all from "./texts";
console.log(lengths, both(), FIRST.length, all.SECOND.length, Object.keys(all).sort().join(), all.SECOND);
