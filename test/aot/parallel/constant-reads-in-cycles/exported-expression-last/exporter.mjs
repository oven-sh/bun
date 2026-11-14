import { call } from "./importer.mjs";
call("first");
var KEY = "late";
export var read = function () { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; };
