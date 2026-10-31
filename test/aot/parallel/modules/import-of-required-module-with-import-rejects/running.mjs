import { value } from "./imported.mjs";
console.log("running begins with", value);
require("./imports-back.mjs");
throw new Error("thrown by running");
