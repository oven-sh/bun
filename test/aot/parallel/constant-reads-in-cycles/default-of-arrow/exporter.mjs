import { call } from "./importer.mjs";
call("first");
var KEY = "late";
export default () => KEY === undefined ? "early" : { late: KEY + "!" }[KEY];
call("second");
