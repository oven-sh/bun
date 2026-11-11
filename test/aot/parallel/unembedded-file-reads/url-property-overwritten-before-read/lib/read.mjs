import { readFileSync } from "node:fs";
function change(o) {
  o.url = "file:///made-up/place/x.mjs";
}
export function stores(options) {
  options.url = "file:///made-up/place/x.mjs";
  return readFileSync(new URL("./data.txt", options.url), "utf8");
}
export function deletes(options) {
  delete options.url;
  return readFileSync(new URL("./data.txt", options.url), "utf8");
}
export function assigns(options) {
  Object.assign(options, { url: "file:///made-up/place/x.mjs" });
  return readFileSync(new URL("./data.txt", options.url), "utf8");
}
export function handsOn(options) {
  change(options);
  return readFileSync(new URL("./data.txt", options.url), "utf8");
}
export function reads(options) {
  return readFileSync(new URL("./data.txt", options.url), "utf8");
}
