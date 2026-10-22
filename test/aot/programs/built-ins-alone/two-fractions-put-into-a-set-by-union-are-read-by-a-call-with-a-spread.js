const held = new Set().union(new Set([1.5, 2.5]));
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
