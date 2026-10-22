const held = new Set();
held.add("text");
held.add("more text");
function use(first, second) {
  console.log(first.length, second.length);
}
use(...held);
