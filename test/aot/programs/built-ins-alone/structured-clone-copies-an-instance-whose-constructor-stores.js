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
const copy = structuredClone(target);
console.log(copy === target, copy.value + 1, typeof copy.next, Object.keys(copy).join());
