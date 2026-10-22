import { log } from "./log.js";
function early() { return require("./reader.js"); }
early();
export var x = 1;
export let y = 2;
log.push("owner ran");
