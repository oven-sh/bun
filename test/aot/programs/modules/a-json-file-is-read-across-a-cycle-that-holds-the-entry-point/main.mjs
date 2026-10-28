// The entry point and caller.mjs import each other. caller.mjs runs first and has the entry point read data.json.
import "./caller.mjs";
import data from "./data.json";
export function early() {
  return JSON.stringify(data);
}
console.log("main:", early());
