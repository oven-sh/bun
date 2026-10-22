class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
try {
  Object.keys(
    new Proxy({}, {
      ownKeys() {
        throw new Item(1.5);
      },
    }),
  );
} catch (error) {
  console.log(error.double());
}
