// Compiled code comes by the namespace of a file of data through import.meta.glob(): the file keeps every name.
import { one } from "./reads-one-name.mjs";
const found = import.meta.glob("./*.json");
const got = await found["./rows.json"]();
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
