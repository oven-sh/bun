// Whoever takes a module from either kind of loader asks it for `__esModule` first. The mark that stands beside the default export of a list is kept though no written import reads it.
import rows from "./rows.json";
const load = new Function("p", "return import(p)");
const got = await load(import.meta.dirname + "/rows.json");
const list = got && got.__esModule && got.default ? got.default : (got.default ?? got);
console.log(rows.length, list.length, got.__esModule);
