// require() of a file of data that an import has loaded answers as the loader would: what it answers is whole.
import { one } from "./reads-one-name.mjs";
import rows from "./rows.json";
const got = import.meta.require("./rows.json");
console.log(one, String(got.b), "b" in got, got === rows || Object.keys(got).sort().join());
