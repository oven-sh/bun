import "./b.mjs";
import { WriteStream } from "node:fs";
export function held() {
  return WriteStream.name;
}
console.log("a", held());
