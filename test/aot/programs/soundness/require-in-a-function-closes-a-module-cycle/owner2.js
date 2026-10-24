import { log } from "./log.js";
var key; const table = { a() { return 0; }, undefined() { return require("./reader2.js"); } };
function early() { return table[key](); }
early();
var key = "a";
export var x = 1;
export let y = 2;
log.push("owner2 ran");
