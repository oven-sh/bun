// The text is handed the object that compiled code holds, not another.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, got.default === rows, got.default.c === rows.c);
