// `new URL("./rows/", import.meta.url)` names a folder, and the build knows which. Whatever goes on from there, a sum, a template or path.join(), finds the files below it.
import { fileURLToPath } from "node:url";
import path from "node:path";
const pick = name => (process.argv.length > 9 ? process.argv[9] : name);
const folder = fileURLToPath(new URL("./rows", import.meta.url));
const here = fileURLToPath(new URL(".", import.meta.url));
const ways = {
  "a path, a slash and a name": () => import(folder + "/" + pick("one.mjs")),
  "the pathname and a name": () => import(new URL("./rows/", import.meta.url).pathname + pick("two.mjs")),
  "the href and a name": () => import(new URL("./rows/", import.meta.url).href + pick("three.mjs")),
  "the URL itself and a name": () => import(new URL("./rows/", import.meta.url) + pick("four.mjs")),
  "a path joined with a name": () => import(path.join(folder, pick("five.mjs"))),
  "the folder of the file joined with two names": () => import(path.join(here, "rows", pick("six.mjs"))),
  "up from the path in the own URL": () => import(path.join(fileURLToPath(import.meta.url), "..", "rows", pick("one.mjs"))),
  "a URL against a URL": () => import(path.resolve(fileURLToPath(new URL("rows", new URL("./", import.meta.url))), pick("two.mjs"))),
};
for (const [way, load] of Object.entries(ways)) console.log(way + ":", await load().then(module => module.row, error => error.name));
