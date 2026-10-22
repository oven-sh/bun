class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
for (const key of Object.getOwnPropertyNames(target)) target[key] = "text";
console.log(typeof target.value, target.value.length, target.next());
