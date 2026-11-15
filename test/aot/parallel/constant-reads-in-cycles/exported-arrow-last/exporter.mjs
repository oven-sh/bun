import { call } from "./importer.mjs";
call("first");
var KEY = "late";
export const read = () => KEY === undefined ? "early" : { late: KEY + "!" }[KEY];
