import { readFileSync } from "node:fs";
const key = "other";
export function stores({ moduleUrl }) {
  moduleUrl = "file:///made-up/place/x.mjs";
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function byComputedKey({ [key]: moduleUrl }) {
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
export function outOfTheRest({ ...rest }) {
  const moduleUrl = rest.other;
  return readFileSync(new URL("./data.txt", moduleUrl), "utf8");
}
