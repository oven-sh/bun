import { call } from "./importer.mjs";
call("first");
var KEY = "late";
const read = () => KEY === undefined ? "early" : { late: KEY + "!" }[KEY];
export { read };
