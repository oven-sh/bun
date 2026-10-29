import "./caller.mjs";
import data from "./data.json";
export function early() {
  return data.version;
}
console.log("reader:", early());
