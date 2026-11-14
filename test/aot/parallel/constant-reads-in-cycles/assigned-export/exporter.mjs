import { call } from "./importer.mjs";
export let read;
read = function () { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; };
call("first");
var KEY = "late";
console.log(read());
