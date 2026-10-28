import "./caller.mjs";
import * as all from "./data.json";
export function early(key = "version") {
  return Object.keys(all).join() + all[key] + Reflect.ownKeys(all).length;
}
console.log("reader:", early());
