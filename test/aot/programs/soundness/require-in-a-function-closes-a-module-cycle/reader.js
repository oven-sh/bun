import { log, attempt } from "./log.js";
import { x, y } from "./owner.js";
log.push("reader x " + (x === undefined ? "missing" : x + 1));
log.push("reader y " + attempt(() => y + 1));
