import { Second } from "./index";

console.log("three/third");

export class Third extends Second {
  names() {
    return [...super.names(), "Third"];
  }
}
