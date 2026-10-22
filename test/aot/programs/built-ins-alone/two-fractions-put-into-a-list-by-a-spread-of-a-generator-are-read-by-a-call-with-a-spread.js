function* values() {
  yield 1.5;
  yield 2.5;
}
const held = [...values()];
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
