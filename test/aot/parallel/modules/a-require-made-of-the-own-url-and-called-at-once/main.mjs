// A require() made of the own URL and called at once loads its file where import.meta is handed on or stored into.
import { createRequire, createRequire as make } from "node:module";
import { note, notes } from "./notes.mjs";
note(import.meta);
import.meta.tide = "ebb";
const { port } = createRequire(import.meta.url)("./harbor.json");
console.log(port, createRequire(import.meta.url)("./tug.cjs").name, make(import.meta.filename)("./tug.cjs").pull(2));
function later() {
  return createRequire(import.meta.url)("./tug.cjs") === createRequire(import.meta.url)("./tug.cjs");
}
console.log(later(), notes.length, import.meta.tide);
try {
  createRequire(new URL("./elsewhere/main.mjs", import.meta.url))("./tug.cjs");
} catch (error) {
  console.log(error.code);
}
