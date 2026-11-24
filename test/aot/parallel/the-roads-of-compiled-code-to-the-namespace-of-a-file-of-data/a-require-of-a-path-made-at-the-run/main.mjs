// The same where the path is made when the program runs.
import { one } from "./reads-one-name.mjs";
const got = import.meta.require(import.meta.dirname + "/rows.json");
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
