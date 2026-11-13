import call from "./importer.cjs";
export function read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; }
call("first", read);
var KEY = "late";
call("second", read);
