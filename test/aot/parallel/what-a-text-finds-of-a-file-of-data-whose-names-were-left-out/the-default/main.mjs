// No written import reads `b` and `c`, so the build keeps no variable for them. A text that is evaluated imports the file by a made path: the default export is whole.
import rows, { a } from "./rows.json";
const load = (0, eval)("p => import(p)");
const got = await load(import.meta.dirname + "/rows.json");
console.log(a, got.default.b, Object.keys(got.default).join());
