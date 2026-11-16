import { call } from "./importer.mjs";
call("first");
var KEY = "late";
function read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; }
export { read as other };
console.log(read());
