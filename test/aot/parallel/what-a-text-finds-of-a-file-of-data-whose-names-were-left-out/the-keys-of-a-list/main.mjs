// The top of the file is a list: it has no names of its own, and the one that the loader lays beside `default` is listed.
import rows from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(rows.length, Object.keys(got).sort().join(), got.default === rows);
