class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const held = [Promise.reject(new Item(1.5)).catch(reason => reason), Promise.reject(new Item(7)).catch(reason => reason)];
console.log((await held[0]).double(), (await held[1]).double());
