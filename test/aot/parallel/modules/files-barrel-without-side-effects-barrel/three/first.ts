import { Third } from "./index";

console.log("three/first");

export class First {
  names(): string[] {
    return ["First"];
  }
  static last() {
    return new Third();
  }
}
