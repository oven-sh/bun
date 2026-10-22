class Item {
  double() {
    return 3;
  }
}
console.log((await Promise.race([Promise.resolve(new Item())])).double());
