import { log, attempt } from "./log.js";
import { x, y } from "./owner2.js";
log.push("reader2 x " + (x === undefined ? "missing" : x + 1));
log.push("reader2 y " + attempt(() => y + 1));
