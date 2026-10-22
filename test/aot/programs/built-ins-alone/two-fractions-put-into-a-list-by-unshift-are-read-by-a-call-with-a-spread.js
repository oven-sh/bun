const held = [];
held.unshift(2.5);
held.unshift(1.5);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
