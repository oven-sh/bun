import * as all from "node:process";
import "./file.cjs";
console.log("the importer:", "custom" in all, typeof all.custom, Object.keys(all).includes("custom"));
