import { promisify } from "node:util";
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const work = promisify(done => done(null, new Item(1.5)));
console.log((await work()).double());
