const held = [];
held.push(7);
held.push(1.5);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
