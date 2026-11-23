import { call } from "./importer.mjs";
call("first");
var KEY = "late";
export default class Gauge { mode = KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; }
console.log(new Gauge().mode);
