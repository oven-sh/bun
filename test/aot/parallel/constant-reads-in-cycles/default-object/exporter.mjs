import { call } from "./importer.mjs";
call("first");
var KEY = "late";
export default { read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; } };
