const held = new Set();
held.add(7);
held.add(1.5);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
