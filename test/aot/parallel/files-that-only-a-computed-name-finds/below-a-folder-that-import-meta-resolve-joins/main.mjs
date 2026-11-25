import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const pick = name => (process.argv.length > 9 ? process.argv[9] : name);
const base = import.meta.resolve("./plugins/");
async function report(way, load) {
  let said;
  try { said = (await load()).said; } catch (error) { said = error.code; }
  console.log(way + ":", said);
}
await report("the text goes on", () => import(base + pick("first") + ".mjs"));
await report("the path goes on", () => require(path.join(fileURLToPath(base), pick("second") + ".cjs")));
