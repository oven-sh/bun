import { Leaf } from "../index";

console.log("nested/inner/root");

export class Root {
  static grow() {
    return new Leaf();
  }
}
