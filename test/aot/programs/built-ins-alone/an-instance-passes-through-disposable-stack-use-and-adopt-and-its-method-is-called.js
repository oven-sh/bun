class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
const stack = new DisposableStack();
console.log(stack.adopt(new Item(1.5), value => console.log(value.double())).double());
stack.dispose();
