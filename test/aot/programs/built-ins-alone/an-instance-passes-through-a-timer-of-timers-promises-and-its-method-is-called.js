import { setTimeout } from "node:timers/promises";
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
console.log((await setTimeout(1, new Item(1.5))).double());
