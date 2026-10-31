// A path is put together from import.meta.dir and a string, and a method of another file hands it to import().
import { Loader } from "./src/loader.mjs";
import { used } from "./src/a.mjs";
const all = await new Loader().load(import.meta.dir + "/src/a.mjs");
console.log(used(), Object.keys(all).sort().join(), all.used === used);
