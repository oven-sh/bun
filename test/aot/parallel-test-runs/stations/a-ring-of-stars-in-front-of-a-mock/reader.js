import { fn as throughA, ownOfA, ownOfB } from "./a.js";
import { fn as throughB } from "./b.js";

export const read = () => [throughA(), throughB(), ownOfA, ownOfB, throughA === throughB].join();
export function readInLoop() {
  let seen = "";
  for (let i = 0; i < 300; i++) seen = throughA() + "," + throughB();
  return seen;
}
