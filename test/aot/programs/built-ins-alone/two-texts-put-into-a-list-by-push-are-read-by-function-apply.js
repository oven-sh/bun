const held = [];
held.push("text");
held.push("more text");
function use(first, second) {
  console.log(first.length, second.length);
}
use.apply(null, held);
