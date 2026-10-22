import { AsyncLocalStorage } from "node:async_hooks";
class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const storage = new AsyncLocalStorage();
storage.run(new Item(1.5), () => console.log(storage.getStore().double()));
