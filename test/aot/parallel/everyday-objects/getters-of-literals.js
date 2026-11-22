// Accessors of object literals, spread into data fields
function box(width, height) {
  const shape = {
    width,
    get area() {
      return this.width * height;
    },
    set area(value) {
      this.width = value / height;
    },
  };
  const copy = { ...shape };
  shape.area = 60;
  return [shape.width, shape.area, copy.area, copy.width, typeof Object.getOwnPropertyDescriptor(copy, "area").get].join();
}
console.log(box(2, 3));
console.log(box(10, 4));
console.log(box(7, 1));
