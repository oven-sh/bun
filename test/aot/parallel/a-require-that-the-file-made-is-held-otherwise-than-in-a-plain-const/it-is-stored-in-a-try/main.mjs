import { createRequire } from "node:module";
let held;
try {
  held = createRequire(import.meta.url);
} catch {
  held = undefined;
}
console.log("SAID", held("./lib/part.cjs"));
