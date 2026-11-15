import { call } from "./importer.mjs";
export const read = () => KEY === undefined ? "early" : { late: KEY + "!" }[KEY];
call("first");
var KEY = "late";
console.log(read());
