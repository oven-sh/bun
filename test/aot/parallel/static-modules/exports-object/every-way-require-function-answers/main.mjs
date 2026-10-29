// createRequire(), `require` and import.meta.require answer one object for one file.
import { createRequire } from "node:module";
const r = createRequire(import.meta.url);
console.log(r("./a.cjs") === require("./a.cjs"), r("./a.cjs") === import.meta.require("./a.cjs"));
