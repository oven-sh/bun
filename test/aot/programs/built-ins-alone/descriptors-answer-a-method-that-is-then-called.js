class Box {
  size = 1.5;
  double() {
    return this.size * 2;
  }
}
const descriptors = Object.getOwnPropertyDescriptors(Box.prototype);
console.log(descriptors.double.value.call(new Box()) + 1);
