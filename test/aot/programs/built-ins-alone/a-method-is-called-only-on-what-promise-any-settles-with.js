class Item {
  double() {
    return 3;
  }
}
console.log((await Promise.any([Promise.resolve(new Item())])).double());
