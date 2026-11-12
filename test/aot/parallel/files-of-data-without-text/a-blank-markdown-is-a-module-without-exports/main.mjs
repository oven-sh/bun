import { createRequire } from "node:module";
import * as all from "./nothing.md";
const require = createRequire(import.meta.url);
console.log("SAID by a statement [" + Object.keys(all).join() + "]");
for (const name of ["./nothing.md", "./short.markdown", "./full.md"]) {
  const found = await import(name);
  console.log("SAID by import()", name, typeof found.default, "[" + Object.keys(found).join() + "]");
}
console.log("SAID by require", JSON.stringify(require("./nothing.md")), JSON.stringify(require("./full.md")));
