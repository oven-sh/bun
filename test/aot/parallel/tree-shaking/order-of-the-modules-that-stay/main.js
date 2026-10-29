// Files of the application and of a pure package import each other. Each prints when it is evaluated. Some files of the package are not used; those that stay run in the order the imports give. `bun run` also prints b.js (before d.js) and f.js (before app-last.js). `bun build --compile` leaves those two out and keeps the order of the others, and --aot follows it.
// Reference: bun build --compile
import "./app-first.js";
import { c } from "ordered/c.js";
import { a } from "ordered";
import "./app-last.js";

console.log("main", a(), c());
