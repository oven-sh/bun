// The promise of import() asks whatever it is settled with for `then`. A file of data has a key of that name that no written import reads: it is kept, so that the import of a text settles.
import { a } from "./rows.json";
const load = new Function("p", "return import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, got.default.then, got.a, got.then);
