import * as all from "node:process";
import "./module.mjs";
import "./file.cjs";
console.log("the importer", typeof all.custom);
