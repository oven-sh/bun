import { limit, count, bump, Point } from "./holder.mjs";
import { readThroughBarrel } from "./reader.mjs";
function readAll() { return [limit, count, new Point(1).x].join(" "); }
console.log("main", readAll());
bump();
console.log("main", readAll(), readThroughBarrel());
