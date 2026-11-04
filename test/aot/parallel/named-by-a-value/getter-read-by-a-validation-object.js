import { throws } from "node:assert";
class Odd extends Error { get code() { return "ODD"; } }
throws(() => { throw new Odd("odd"); }, { code: "ODD" }); console.log("thrown as described");
