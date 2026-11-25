import { readFileSync } from "node:fs";
const key = "other";
function change(o) {
  o.moduleUrl = "file:///made-up/place/x.mjs";
}
export function byComputedKey(options) {
  const { [key]: moduleUrl } = options;
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function outOfTheRest(options) {
  const { ...rest } = options;
  const moduleUrl = rest.other;
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function storesToTheVariable(options) {
  let { moduleUrl } = options;
  moduleUrl = "file:///made-up/place/x.mjs";
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function storesToTheProperty(options) {
  options.moduleUrl = "file:///made-up/place/x.mjs";
  const { moduleUrl } = options;
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function handsTheObjectOn(options) {
  change(options);
  const { moduleUrl } = options;
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
