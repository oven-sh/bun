// A name that the file does not have is undefined, as on any namespace: so the promise of import() settles.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, got.nothing, got.then);
