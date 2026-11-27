import { call } from "./importer.mjs";
export const api = { read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; } };
call("first");
var KEY = "late";
console.log(api.read());
