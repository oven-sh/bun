import * as all from "node:process";
import "./module.mjs";
console.log("the importer", typeof all.custom);
