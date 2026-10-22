import { Readable } from "node:stream";
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
Readable.from([new Item(1.5)]).on("data", value => console.log(value.double()));
