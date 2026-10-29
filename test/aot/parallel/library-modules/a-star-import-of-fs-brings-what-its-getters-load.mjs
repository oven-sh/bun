// The namespace object of node:fs is made by reading every export, which runs the getters that load the stream modules and node:fs/promises.
// A call of a member of it hands the namespace object to nobody: the other functions of node:fs are not compiled.
// STATISTIC: ImageFunctionsEmitted <= 1100
import * as fs from "node:fs";
console.log(fs.readFileSync("/dev/null").length, fs.existsSync("/dev/null"));
