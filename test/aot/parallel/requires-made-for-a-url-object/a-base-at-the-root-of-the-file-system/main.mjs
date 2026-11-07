// In an executable the entry point lies at /$bunfs/root: two folders up is the root of the file system. A require made for it looks for a relative name
// there, finds nothing and fails, as it does where the program runs from its sources two folders below a folder without such a file.
// An executable took the folder of "/noop.js", which is what createRequire("/") looks from, for its own root, and answered with the file beside the entry point.
// A written createRequire("/") is another matter: see test/aot/a-require-made-for-the-root-of-the-file-system.test.ts.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import "./part.cjs";
const __dirname = dirname(fileURLToPath(import.meta.url));
function report(way, act) {
  let said;
  try { said = act(); } catch (error) { said = error.code ?? error.name; }
  console.log(way + ":", said);
}
report("dirname of dirname", () => createRequire(dirname(dirname(__dirname)) + "/")("./part.cjs").said);
report("a URL two folders up", () => createRequire(new URL("../../", import.meta.url))("./part.cjs").said);
report("a file two folders up", () => createRequire(dirname(dirname(__dirname)) + "/start.cjs")("./part.cjs").said);
report("a URL of a file two folders up", () => createRequire(new URL("../../start.cjs", import.meta.url))("./part.cjs").said);
report("the own folder", () => createRequire(__dirname + "/")("./part.cjs").said);
