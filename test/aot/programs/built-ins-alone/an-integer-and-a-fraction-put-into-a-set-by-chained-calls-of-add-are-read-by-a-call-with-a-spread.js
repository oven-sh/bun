const held = new Set().add(7).add(1.5);
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
