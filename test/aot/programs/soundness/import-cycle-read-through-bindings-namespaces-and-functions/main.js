// Modules that import each other: what the second one reads of the first one before the first one has run.
import { log } from "./log.js";
import "./first.js";
import { after } from "./second.js";
after();
console.log(log.join("\n"));
