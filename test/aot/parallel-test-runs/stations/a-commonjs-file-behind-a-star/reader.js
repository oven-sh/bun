import { flag, fn, renamed } from "./barrel.js";
import * as all from "./barrel.js";

export const read = () => [flag, fn(), renamed].join();
export const readOffObject = () => [all.flag, all.fn(), all.renamed, Object.keys(all).sort().join("+")].join();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = flag + "," + fn() + "," + renamed + "," + all.flag;
  return seen;
}
