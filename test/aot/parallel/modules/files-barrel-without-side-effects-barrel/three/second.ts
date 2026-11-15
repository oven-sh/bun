import { First } from "./index";

console.log("three/second");

export class Second extends First {
  names() {
    return [...super.names(), "Second"];
  }
}
