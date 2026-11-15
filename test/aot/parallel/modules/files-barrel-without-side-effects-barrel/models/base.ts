import { User } from "./index";

console.log("models/base");

export class Base {
  static make() {
    return new User();
  }
}
