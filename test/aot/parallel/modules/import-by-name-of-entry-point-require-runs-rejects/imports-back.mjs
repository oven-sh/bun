import { existsSync } from "node:fs";
console.log("imports-back runs", typeof existsSync);
const importByName = new Function("name", "return import(name)");
importByName(import.meta.resolve("./running.mjs")).then(
  () => console.log("import of running: fulfilled"),
  error => console.log("import of running: rejected,", error.message, "| the error that require threw:", error === globalThis.thrownByRunning),
);
