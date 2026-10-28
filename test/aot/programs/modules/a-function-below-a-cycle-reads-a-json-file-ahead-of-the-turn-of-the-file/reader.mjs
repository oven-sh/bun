import data from "./data.json";
export function early() {
  return JSON.stringify(data);
}
console.log("reader:", early());
