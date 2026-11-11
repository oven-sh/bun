import { c } from "./outer.js";

export const read = () => c();
export const readThrough = pass => pass(c)();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = c();
  return seen;
}
