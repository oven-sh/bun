import { fn, other } from "./barrel.js";

export const read = () => [fn(), other].join();
export const readThrough = pass => [pass(fn)(), pass(other)].join();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = fn();
  return seen;
}
