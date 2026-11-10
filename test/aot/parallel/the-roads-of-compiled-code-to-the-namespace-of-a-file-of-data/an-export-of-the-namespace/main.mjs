// Compiled code comes by the namespace of a file of data through `export * as` of another file: the file keeps every name.
import { one } from "./reads-one-name.mjs";
import { got } from "./hands-on.mjs";
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
