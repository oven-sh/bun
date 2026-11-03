// A named import of a built-in module holds what the module's object held when the module was loaded. A store to the object afterward changes the object alone.
import path, { join } from "node:path";
import os, { hostname } from "node:os";
import util, { format } from "node:util";
import fs, { existsSync } from "node:fs";

const replace = (object: any, name: string) => {
  object[name] = () => "replaced";
};
replace(path, "join");
replace(os, "hostname");
replace(util, "format");
replace(fs, "existsSync");
console.log(join("a", "b"), hostname() === "replaced", format("%s", 1), existsSync("/"));
console.log(path.join("a", "b"), os.hostname(), util.format("%s", 1), fs.existsSync("/"));
