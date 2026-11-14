import { call } from "./importer.mjs";
call("first");
var KEY = "late";
export default (class { mode = KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; });
