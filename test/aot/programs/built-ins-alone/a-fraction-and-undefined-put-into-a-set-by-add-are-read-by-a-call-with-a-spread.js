const held = new Set();
held.add(1.5);
held.add(undefined);
function use(first, second) {
  console.log(first + 1, second === undefined);
}
use(...held);
