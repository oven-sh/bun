// A namespace that is handed to a function and read under a made key keeps every name.
import { one } from "./reads-one-name.mjs";
import * as rows from "./rows.json";
const pick = (from, key) => from[key];
const got = { b: pick(rows, "b".trim()), keys: Object.keys(rows).sort().join() };
console.log(one, String(got.b), got.keys);
