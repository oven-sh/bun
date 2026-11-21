// A path imported under type "file" and then found by a created require() is not what an import() without a type gets.
import { createRequire } from "node:module";
const load = createRequire(import.meta.url);
const path = await import("./part.cjs", { with: { type: "file" } });
load("./part.cjs");
let importsPath = false;
try {
  importsPath = typeof (await import("./part.cjs")).default === "string";
} catch {}
console.log(typeof path.default, importsPath);
