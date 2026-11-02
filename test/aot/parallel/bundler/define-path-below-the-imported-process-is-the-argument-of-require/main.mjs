// `require` takes a name whose `--define` value is a member below the `process` that the file imports. No build follows the environment: the executable loads the module that the run names.
// Flags: --define NAME=process.env.NAME_OF_MODULE
// Env: NAME_OF_MODULE=node:path
import process from "node:process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const path = require("node:path");
console.log(path.basename("/a/b.txt"), require(NAME).basename("/c/d.txt"));
