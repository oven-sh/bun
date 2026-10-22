const held = new Set();
held.add(7);
held.add("text");
function use(first, second) {
  console.log(first + 1, second.length);
}
use(...held);
