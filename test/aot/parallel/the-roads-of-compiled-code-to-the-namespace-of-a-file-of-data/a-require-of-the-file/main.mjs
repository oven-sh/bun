// require() answers the value of a file of data, which is whole whatever names its table holds: no namespace is made.
import { one } from "./reads-one-name.mjs";
import { createRequire } from "node:module";
const got = createRequire(import.meta.url)("./rows.json");
console.log(one, String(got.b), "b" in got, Object.keys(got).sort().join());
