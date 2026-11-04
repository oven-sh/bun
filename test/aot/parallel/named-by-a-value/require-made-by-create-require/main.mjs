// Entry points: ./modules/a.cjs ./modules/b.cjs
const which = globalThis.never ? "a" : "b";
import { createRequire } from "node:module";
const found = createRequire(import.meta.url)("./modules/" + which + ".cjs");
console.log(found.run(), new found.Tool().use(), JSON.stringify(new found.Tool(), ["kind"]));
