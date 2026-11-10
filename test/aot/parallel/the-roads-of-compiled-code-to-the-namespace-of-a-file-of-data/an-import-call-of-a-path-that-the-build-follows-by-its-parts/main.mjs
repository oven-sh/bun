// Compiled code comes by the namespace of a file of data through import() of a path of which the build knows the start: the file keeps every name.
import { one } from "./reads-one-name.mjs";
const name = process.argv.length > 99 ? "other" : "rows";
const got = await import("./" + name + ".json");
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
