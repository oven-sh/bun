function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
console.log(Reflect.get(held, 0) + 1, Reflect.get(held, "1") + 1);
