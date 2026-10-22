const held = [];
held.push(7);
held.push(8);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
