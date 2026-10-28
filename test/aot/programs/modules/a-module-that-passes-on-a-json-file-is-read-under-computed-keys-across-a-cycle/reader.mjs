import "./caller.mjs";
import * as passed from "./passes-on.mjs";
export function early(key) {
  return JSON.stringify(passed[key]);
}
console.log("reader:", early("config"), early("version"));
