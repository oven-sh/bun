class Box {
  size = 1.5;
  get double() {
    return this.size + this.size;
  }
}
console.log(Reflect.get(new Box(), "double", { size: "ab" }));
