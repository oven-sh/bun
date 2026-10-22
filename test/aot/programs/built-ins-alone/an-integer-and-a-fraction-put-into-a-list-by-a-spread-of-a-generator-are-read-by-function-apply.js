function* values() {
  yield 7;
  yield 1.5;
}
const held = [...values()];
function use(first, second) {
  console.log(first + 1, second + 1);
}
use.apply(null, held);
