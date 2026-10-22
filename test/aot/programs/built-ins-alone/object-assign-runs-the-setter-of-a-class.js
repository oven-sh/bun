class Box {
  stored = 0;
  set value(value) {
    console.log("setter", typeof value);
    this.stored = value;
  }
}
const box = Object.assign(new Box(), { value: "text" });
console.log(typeof box.stored, box.stored.length);
