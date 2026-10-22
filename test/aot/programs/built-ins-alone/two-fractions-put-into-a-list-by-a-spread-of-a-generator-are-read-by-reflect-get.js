function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
