import { createRequire } from "node:module";
import * as namespace from "node:process";
Object.keys(namespace);
const held = createRequire(import.meta.url)("node:process");
for (const name of ["title", "report", "features"]) held[name] = 1;
held.exitCode = 0;
console.log(typeof namespace.title, typeof namespace.report, typeof namespace.features, typeof namespace.exitCode);
