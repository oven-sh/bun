// A require made for a folder that has nothing to do with the program. A relative name means a file beside that folder: there is none, and the load fails.
// An executable looked for a name that it had not found once more from its own root, and answered with the file of that name beside the entry point.
import { createRequire } from "node:module";
import "./part.cjs";
const pick = text => (process.argv.length > 9 ? process.argv[9] : text);
function report(way, act) {
  let said;
  try { said = act(); } catch (error) { said = error.code ?? error.name; }
  console.log(way + ":", said);
}
report("a folder that the build does not know", () => createRequire(pick("/nowhere/at/all/"))(pick("./part.cjs")).said);
report("a file that the build does not know", () => createRequire(pick("/nowhere/at/all/start.cjs"))("./part.cjs").said);
report("resolve", () => createRequire(pick("/nowhere/at/all/")).resolve(pick("./part.cjs")));
report("a written folder", () => createRequire("/nowhere/at/all/")("./part.cjs").said);
report("the URL of the file, moved there", () => {
  const place = new URL(import.meta.url);
  place.pathname = "/nowhere/at/all/start.mjs";
  return createRequire(place)("./part.cjs").said;
});
report("one folder up from there", () => createRequire(pick("/nowhere/at/all/"))(pick("../part.cjs")).said);
report("the own folder", () => createRequire(import.meta.url)("./part.cjs").said);
