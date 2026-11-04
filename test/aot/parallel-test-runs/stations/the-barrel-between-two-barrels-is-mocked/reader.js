import { fn } from "./outer.js";
import * as all from "./outer.js";

const said = read => {
  try {
    return String(read());
  } catch {
    return "threw";
  }
};

export const read = () => fn();
export const readOffObject = () => [said(() => all.fn()), said(() => all.kept), Object.keys(all).sort().join("+")].join();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = fn() + "," + all.fn();
  return seen;
}
