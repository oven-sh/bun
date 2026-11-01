// The URL that createRequire is given reaches it through a field, and the require it makes finds a compiled file by a constant path.
import { createRequire } from "node:module";
const load = createRequire({ held: import.meta.url }.held);
console.log(load("./a.cjs") === require("./a.cjs"), load("./a").a, load("../create-require-url-held-in-field/a.cjs").a);
