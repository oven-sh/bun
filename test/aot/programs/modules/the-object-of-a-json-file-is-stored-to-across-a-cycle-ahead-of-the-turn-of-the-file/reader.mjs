import "./caller.mjs";
import data from "./data.json";
export function early() {
  data.list.push(data.list.length);
  return data.list.join();
}
console.log("reader:", early());
