class Box {
  size = 1.5;
  get double() {
    console.log("getter");
    return this.size * 2;
  }
}
console.log(Reflect.get(new Box(), "double") + 1);
