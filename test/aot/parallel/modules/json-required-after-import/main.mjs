// require() of a JSON file that the entry point also imports answers the namespace object of that import.
import a from "./a.json";
import * as b from "./b.json";
import { another } from "./c.json";
import list from "./list.json";
import text from "./text.json";
import hasdefault from "./hasdefault.json";
import marked from "./marked.json";
import req from "./req.cjs";
function describe(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return [Object.prototype.toString.call(value), Reflect.ownKeys(value).map(String).join(), JSON.stringify(value.default), String(value.__esModule)].join(" ");
}
console.log("default import first:", describe(req.a()), req.a() === a);
console.log("star import first:", describe(req.b()), req.b() === b.default);
console.log("named import first:", describe(req.c()), another);
console.log("array:", describe(req.list()), req.list() === list, Array.isArray(req.list()));
console.log("string:", describe(req.text()), req.text() === text);
console.log("member named default:", describe(req.hasdefault()), req.hasdefault() === hasdefault);
console.log("member named __esModule:", describe(req.marked()), req.marked() === marked);
a.changed = 1;
console.log("changed through the import:", JSON.stringify(req.a()));
