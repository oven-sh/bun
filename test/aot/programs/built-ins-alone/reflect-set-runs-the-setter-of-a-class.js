class Box {
  stored = 0;
  set value(value) {
    console.log("setter", typeof value);
    this.stored = value;
  }
}
const box = new Box();
Reflect.set(box, "value", "text");
console.log(typeof box.stored, box.stored.length);
