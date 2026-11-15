import { call } from "./importer.mjs";
call("first");
var KEY = "late";
export default function read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; }
console.log(read());
