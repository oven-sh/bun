class Box {
  stored = 0;
  set value(value) {
    this.stored = value;
  }
}
const box = new Box();
box.__lookupSetter__("value").call(box, "text");
console.log(typeof box.stored, box.stored.length);
