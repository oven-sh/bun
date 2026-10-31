// lib.cjs reads `.default` of a required JSON file. require() answers the namespace object, because main.mjs imports the same file.
const later = await import("./barrel.mjs");
import below from "./inner.json";
try {
  console.log("it is", later)} catch (error) {
}
