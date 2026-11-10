// A loop over the names meets those that were left out.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
const seen = [];
for (const key in got) seen.push(key);
console.log(a, seen.sort().join(), Reflect.ownKeys(got).length);
