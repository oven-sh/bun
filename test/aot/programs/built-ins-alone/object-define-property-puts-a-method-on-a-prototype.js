class Box {
  size = 1.5;
}
Object.defineProperty(Box.prototype, "double", {
  value() {
    return this.size * 2;
  },
});
console.log(new Box().double() + 1);
