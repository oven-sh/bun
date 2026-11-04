import { fn, other } from "./barrel.js";
import * as all from "./barrel.js";

const said = read => {
  try {
    return String(read());
  } catch {
    return "threw";
  }
};

export const read = () => [fn(), other].join();
export const readOffObject = () =>
  [said(() => all.fn()), said(() => all.other), said(() => all.dropped), "dropped" in all, Object.keys(all).sort().join("+")].join();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = fn() + "," + all.fn() + "," + other;
  return seen;
}
