import { existsSync } from "node:fs";
console.log("imports-back runs", typeof existsSync);
const importByName = new Function("name", "return import(name)");
importByName(import.meta.resolve("./running.mjs")).then(
  names => console.log("import of running: fulfilled, ended:", names.ended),
  error => console.log("import of running: rejected,", error.message),
);
