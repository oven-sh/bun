class Box {
  size = 1.5;
  get double() {
    return this.size * 2;
  }
}
const box = new Box();
console.log(box.__lookupGetter__("double").call(box) + 1);
