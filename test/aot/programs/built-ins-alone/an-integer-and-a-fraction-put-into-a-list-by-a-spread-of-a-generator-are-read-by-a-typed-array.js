function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
const view = new Float64Array(held);
console.log(view[0] + 1, view[1] + 1);
