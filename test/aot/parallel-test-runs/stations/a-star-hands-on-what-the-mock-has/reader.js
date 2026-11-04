import { fn, other, unrelated } from "./barrel.js";

export const read = () => [fn(), other, unrelated].join();
export const readThrough = pass => [pass(fn)(), pass(other), pass(unrelated)].join();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = fn() + "," + other;
  return seen;
}
