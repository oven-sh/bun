// A name that a written re-export asks of stars of a CommonJS file, and that the file lacks, comes by the other stars, as in bun run.
import * as names from "./outer.mjs";
import * as other from "./renamed.mjs";
import { onlyLast } from "./outer.mjs";
console.log("keys", Object.keys(names).join(), onlyLast, names.other);
console.log("renamed", Object.keys(other).join(), other.onlyLast, other.held);
