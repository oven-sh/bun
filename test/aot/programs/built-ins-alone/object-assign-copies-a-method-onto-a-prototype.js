class Box {
  size = 1.5;
}
Object.assign(Box.prototype, {
  double() {
    return this.size * 2;
  },
});
console.log(new Box().double() + 1);
