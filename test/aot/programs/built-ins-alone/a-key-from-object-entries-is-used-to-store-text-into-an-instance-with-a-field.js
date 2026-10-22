class Box {
  value = 1;
  next() {
    return this.value + 1;
  }
}
const target = new Box();
console.log(target.next());
for (const [key, value] of Object.entries(target)) target[key] = `text ${value}`;
console.log(typeof target.value, target.value.length, target.next());
