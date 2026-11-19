import { call } from "./importer.mjs";
call("first");
var KEY = "late";
class Gauge { mode = KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; read() { return KEY === undefined ? "early" : { late: KEY + "!" }[KEY]; } }
export { Gauge };
console.log(new Gauge().mode, new Gauge().read());
