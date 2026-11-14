// `in` finds the names that were left out, and no others.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, "b" in got, "nothing" in got, Object.hasOwn(got, "c"));
