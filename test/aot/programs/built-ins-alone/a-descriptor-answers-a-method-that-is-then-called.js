class Box {
  size = 1.5;
  double() {
    return this.size * 2;
  }
}
const { value } = Object.getOwnPropertyDescriptor(Box.prototype, "double");
console.log(value.call(new Box()) + 1);
