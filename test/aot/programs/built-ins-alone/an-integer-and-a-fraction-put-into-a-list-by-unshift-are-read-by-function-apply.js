const held = [];
held.unshift(1.5);
held.unshift(7);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use.apply(null, held);
