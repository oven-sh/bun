import * as own from "./exporter.mjs";
console.log(own.read());
var KEY = "late";
export function read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; }
console.log(own.read());
export function call() {}
