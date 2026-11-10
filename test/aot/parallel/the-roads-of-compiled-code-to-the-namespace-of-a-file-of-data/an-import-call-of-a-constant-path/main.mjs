// Compiled code comes by the namespace of a file of data through import() of a constant path: the file keeps every name.
import { one } from "./reads-one-name.mjs";
const got = await import("./rows.json");
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
