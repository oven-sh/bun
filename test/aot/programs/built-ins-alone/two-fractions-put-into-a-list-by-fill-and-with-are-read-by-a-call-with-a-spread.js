const held = new Array(2).fill(1.5).with(1, 2.5);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
