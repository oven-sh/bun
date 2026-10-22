const held = Array.of(7, 1.5);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use.apply(null, held);
