const held = [];
held[0] = 1.5;
held[1] = 2.5;
function use(first, second) {
  console.log(first + 1, second + 1);
}
use.apply(null, held);
