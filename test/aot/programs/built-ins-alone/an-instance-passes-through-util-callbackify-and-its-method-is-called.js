import { callbackify } from "node:util";
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
callbackify(async () => new Item(1.5))((error, value) => console.log(value.double()));
