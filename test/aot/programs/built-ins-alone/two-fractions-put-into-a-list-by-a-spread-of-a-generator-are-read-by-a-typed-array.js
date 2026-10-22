function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
