class Box {
  constructor(value) {
    this.value = value;
  }
  next() {
    return this.value + 1;
  }
}
const target = new Box(1);
console.log(target.next());
const heir = Object.create(target, { added: { value: "text", enumerable: true } });
console.log(heir.value + 1, heir.added.length, Object.keys(heir).join(), Object.getPrototypeOf(heir) === target);
