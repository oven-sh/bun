class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.reject(new Item(1.5)).catch(reason => reason), Promise.reject(new Item(7)).catch(reason => reason)];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0].double(), list[1].double());
