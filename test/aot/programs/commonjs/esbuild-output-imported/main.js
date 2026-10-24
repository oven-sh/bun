// ES modules import CommonJS modules in the form esbuild gives to what was an ES module.
import main, { add, limit, Shape, Kind, renamed } from "./files/plain.js";
import { count, increment } from "./files/live.js";
import whole, { one, two } from "./files/without_default.js";
import * as all from "./files/as_a_namespace.js";
import * as some from "./files/without_default.js";
console.log(add(limit, 1), new Shape(3).describe(), Kind.Round, renamed(), typeof main, typeof main === "function" ? main() : Object.keys(main).join());
console.log(count, increment(), count, increment(), count);
console.log(one, two(), typeof whole, Object.keys(whole).join());
console.log(Object.keys(all).join(), all.a, all.b, typeof all.default, JSON.stringify(all.default));
console.log(some.one, some.two(), "default" in some, Object.keys(some).join());
import("./files/plain.js").then(ns => console.log(Object.keys(ns).join(), ns.add(1, 1), typeof ns.default));
