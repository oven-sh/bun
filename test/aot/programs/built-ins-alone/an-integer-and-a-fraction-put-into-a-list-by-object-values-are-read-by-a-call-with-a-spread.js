const held = Object.values({ a: 7, b: 1.5 });
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
