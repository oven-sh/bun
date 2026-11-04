import { fn } from "./barrel.js";

export const read = () => fn();
export const readThrough = pass => pass(fn)();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = fn();
  return seen;
}
