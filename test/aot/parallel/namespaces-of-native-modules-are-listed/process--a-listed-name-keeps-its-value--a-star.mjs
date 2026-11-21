// A list of the names reads each export, as in plain Bun. A write to process behind it is not seen through the namespace.
import * as held from "node:process";
Object.keys(held);
process.exitCode = 0;
process.title = "renamed";
process.report = 3;
process.features = 2;
console.log(typeof held.exitCode, held.title === "renamed", typeof held.report, typeof held.features, typeof process.features);
