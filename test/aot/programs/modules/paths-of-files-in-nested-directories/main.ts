// The table of modules keeps the path of a file as its directory and its name. Every way to see a path puts it together again.
import { where as whereC, fail as failC } from "./a/b/c/leaf.ts";
import { where as whereD } from "./a/b/d/leaf.ts";
import { where as whereE } from "./a/e/leaf.ts";
import { where as whereAccent } from "./a/né/leaf.ts";
import { where as whereTop } from "./top.ts";
const root = import.meta.dir;
const rootOfUrls = "file://" + (root.startsWith("/") ? "" : "/") + root.replaceAll("\\", "/");
const relative = (path: string) => (path.startsWith(root) ? path.slice(root.length) : path.replace(rootOfUrls, "file://"));
for (const where of [whereC, whereD, whereE, whereAccent, whereTop, () => import.meta])
  console.log(relative(where().path), relative(decodeURI(where().url)), relative(where().dir), where().file);
try {
  failC();
} catch (error) {
  console.log((error as Error).stack!.split("\n").slice(0, 3).map(line => line.replace(root, "").trim()).join(" | "));
}
for (const name of ["c", "d", "missing"]) {
  try {
    console.log(relative((await import(`./a/b/${name}/leaf.ts`)).where().path));
  } catch (error) {
    console.log("no", name, (error as { code?: string }).code);
  }
}
const required = require("./cjs/inner/module.cjs");
console.log(relative(required.filename), relative(required.dirname), relative(required.id), relative(required.again().filename));
