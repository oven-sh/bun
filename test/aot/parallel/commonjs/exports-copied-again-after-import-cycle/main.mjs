// A CommonJS file requires the ES module that imports it. The exports are copied when that module is linked, while the file runs, and once more when the file has returned: each copy runs the getters. Importers keep the first copy.
import * as early from "./file.cjs";
console.log("main runs", Object.keys(early).join());
setTimeout(async () => {
  const late = await import("./file.cjs");
  console.log("later", late === early, Object.keys(late).join());
});
