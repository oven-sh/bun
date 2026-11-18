import imported from "one-function";
const required = require("one-function");
console.log(imported(), required(), require("one-function")(), imported.name, required.name);
