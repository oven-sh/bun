class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
await Promise.race([Promise.reject(new Item(1.5))]).catch(error => console.log(error.double()));
