// A second import finds the same namespace.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, got === (await load(import.meta.dirname + "/rows.json")));
