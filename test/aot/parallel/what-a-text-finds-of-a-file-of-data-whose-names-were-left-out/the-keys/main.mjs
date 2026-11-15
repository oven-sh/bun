// The names that were left out are listed all the same.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, Object.keys(got).sort().join());
