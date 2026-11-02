import { existsSync } from "node:fs";
console.log("drains runs", typeof existsSync);
new Function("name", "return import(name)")(import.meta.resolve("./reads.mjs")).then(
  () => console.log("import of reads: fulfilled"),
  error => console.log("import of reads: rejected,", error.message),
);
