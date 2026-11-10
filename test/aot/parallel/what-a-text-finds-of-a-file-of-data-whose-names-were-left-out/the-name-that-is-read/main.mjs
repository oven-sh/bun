// The name that a written import reads is read off the namespace too.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, got.a);
