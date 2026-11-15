// The namespace object goes into the call as `this` and nobody looks into it: the file stays in sight.
// STATISTIC: ImageFunctionsEmitted <= 700
import * as fs from "node:fs";
console.log(fs.existsSync("/"));
