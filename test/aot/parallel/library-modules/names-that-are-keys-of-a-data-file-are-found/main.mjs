// The names of the modules are keys of a data file that the program imports, as in the dependencies of a package.json, and reach a made require that nobody follows.
import { createRequire } from "node:module";
import names from "./names.json";
const load = [createRequire(import.meta.url)][JSON.parse("0")];
for (const name of [...Object.keys(names), ...Object.keys(names.deep)]) {
  if (name !== "deep") console.log(name, typeof load(name));
}
