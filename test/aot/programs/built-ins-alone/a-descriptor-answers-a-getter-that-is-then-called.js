class Box {
  size = 1.5;
  get double() {
    return this.size * 2;
  }
}
const { get } = Object.getOwnPropertyDescriptor(Box.prototype, "double");
console.log(get.call(new Box()) + 1);
