// Compiled code comes by the namespace of a file of data through import() of a path that is made when the program runs: every file of data keeps every name.
import { one } from "./reads-one-name.mjs";
const got = await import(import.meta.dirname + "/rows.json");
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
