import { PathLike } from "node:fs";
export function unused() {
  // @ts-ignore
  return PathLike;
}
console.log("never");
