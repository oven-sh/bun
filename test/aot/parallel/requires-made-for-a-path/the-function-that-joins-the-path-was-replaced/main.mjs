// createRequire(path.join(import.meta.dirname, ..)): the build reads the path out of what is written and binds the loads through the require to its folder.
// path.join is an ordinary member that a program may store to. Where it gives another path, the require looks from another folder: compiled code refuses a file below it aloud
// (docs/compiler/compatibility.mdx); what this holds is that the file which the written path would find is never taken for it, and that everything else answers as ever.
import { createRequire } from "node:module";
import path from "node:path";
import "./part.cjs";
import "./other/part.cjs";
import "./vendor/part.cjs";
const { join, resolve } = path;
function report(way, act) {
  let said;
  try { said = act(); } catch (error) { said = error.code ?? error.name; }
  path.join = join;
  path.resolve = resolve;
  console.log(way + ":", said);
}
report("as it is", () => createRequire(path.join(import.meta.dirname, "start.cjs"))("./part.cjs").said);
report("as it is, another folder", () => createRequire(path.join(import.meta.dirname, "vendor", "start.cjs"))("./part.cjs").said);
report("replaced, the same path", () => {
  path.join = (...parts) => join(...parts);
  const load = createRequire(path.join(import.meta.dirname, "start.cjs"));
  return load("./part.cjs").said;
});
report("replaced, the same path, another folder", () => {
  path.join = (...parts) => join(...parts);
  const load = createRequire(path.join(import.meta.dirname, "vendor", "start.cjs"));
  return load("./part.cjs").said;
});
report("replaced, another folder: the file beside the program is taken for it", () => {
  path.join = (...parts) => join(...parts, "..", "other", "start.cjs");
  const load = createRequire(path.join(import.meta.dirname, "start.cjs"));
  let said;
  try { said = load("./part.cjs").said; } catch (error) { said = error.code; }
  return said === "beside main";
});
report("resolve replaced, another folder: the file of the written folder is taken for it", () => {
  path.resolve = (...parts) => resolve(...parts, "..", "..", "other", "start.cjs");
  const load = createRequire(path.resolve(import.meta.dirname, "vendor", "start.cjs"));
  let said;
  try { said = load("./part.cjs").said; } catch (error) { said = error.code; }
  return said === "in vendor";
});
report("replaced, another folder, a built-in module", () => {
  path.join = (...parts) => join(...parts, "..", "other", "start.cjs");
  const load = createRequire(path.join(import.meta.dirname, "start.cjs"));
  return typeof load("node:os").platform + " " + load.resolve("node:fs");
});
report("a sum of texts", () => createRequire(import.meta.dirname + "/vendor/start.cjs")("./part.cjs").said);
