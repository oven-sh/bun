// Compiled code comes by the names of a file of data through the star of a barrel whose namespace it takes: the file keeps every name.
import { one } from "./reads-one-name.mjs";
import * as got from "./barrel.mjs";
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
