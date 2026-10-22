class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const thenable = {
  then(resolve) {
    resolve(new Item(1.5));
  },
};
console.log((await Promise.all([thenable]))[0].double());
