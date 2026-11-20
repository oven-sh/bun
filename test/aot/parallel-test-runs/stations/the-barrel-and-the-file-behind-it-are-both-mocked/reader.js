import { fn as throughBarrel } from "./barrel.js";
import { fn as fromFile } from "./lib.js";

export const readThroughBarrel = () => throughBarrel();
export const readFromFile = () => fromFile();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = throughBarrel() + "," + fromFile();
  return seen;
}
