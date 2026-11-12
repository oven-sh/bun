// A module that makes itself __dirname, and a require for the folder two levels up. One path has many spellings;
// the build holds the value that createRequire() is given against the written path whichever it comes in.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
function report(way, act) {
  let said;
  try { said = act(); } catch (error) { said = error.code ?? error.name; }
  console.log(way + ":", said);
}
report("join and a separator", () => createRequire(join(__dirname, "..", "..") + "/")("./part.cjs").said);
report("resolve and a separator", () => createRequire(resolve(__dirname, "../..") + "/")("./part.cjs").said);
report("join and a file", () => createRequire(join(__dirname, "..", "..") + "/start.cjs")("./part.cjs").said);
report("a template", () => createRequire(`${__dirname}/../../`)("./part.cjs").said);
report("one folder up", () => createRequire(join(__dirname, "..") + "/")("./part.cjs").said);
