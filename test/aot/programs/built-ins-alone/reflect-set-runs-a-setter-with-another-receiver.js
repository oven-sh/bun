class Box {
  set value(value) {
    this.stored = value;
  }
}
const other = { stored: 0 };
Reflect.set(new Box(), "value", "text", other);
console.log(typeof other.stored, other.stored.length);
