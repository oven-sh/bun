import { call } from "./importer.mjs";
const read = () => KEY === undefined ? "early" : { late: KEY + "!" }[KEY];
call("first");
var KEY = "late";
console.log(read());
export { read };
