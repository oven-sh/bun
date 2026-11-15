// The everyday form. One function of node:fs is called: the program brings that function and what it reaches, as with require("node:fs"), and not all that the file exports.
// STATISTIC: ImageFunctionsEmitted <= 700
import fs from "node:fs";
console.log(fs.existsSync("/"));
