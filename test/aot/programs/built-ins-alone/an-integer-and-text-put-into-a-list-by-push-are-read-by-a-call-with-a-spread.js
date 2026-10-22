const held = [];
held.push(7);
held.push("text");
function use(first, second) {
  console.log(first + 1, second.length);
}
use(...held);
