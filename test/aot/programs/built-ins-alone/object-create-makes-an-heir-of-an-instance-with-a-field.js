class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
const heir = Object.create(target, { added: { value: "text", enumerable: true } });
console.log(heir.value + 1, heir.added.length, Object.keys(heir).join(), Object.getPrototypeOf(heir) === target);
