// import() of a path made of the folder of the importing file and the separator of node:path, or of the URL of that folder.
import { dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
const here = new URL(".", import.meta.url);
const loads = {
  "a folder made of the URL, and the separator": () => import(dirname(fileURLToPath(import.meta.url)) + sep + "first.mjs"),
  "import.meta.dir and the separator": () => import(import.meta.dir + sep + "second.mjs"),
  "the pathname of the folder's URL": () => import(new URL(".", import.meta.url).pathname + "third.mjs"),
  "the folder's URL in a variable": () => import(here.pathname + "fourth.mjs"),
  "the href of the folder's URL": () => import(new URL("./", import.meta.url).href + "fifth.mjs"),
};
for (const [name, load] of Object.entries(loads)) {
  try {
    console.log(name + ":", (await load()).default);
  } catch (error) {
    console.log(name + ":", error.code);
  }
}
