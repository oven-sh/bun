const held = [];
held.push(1.5);
held.push(undefined);
function use(first, second) {
  console.log(first + 1, second === undefined);
}
use(...held);
