const held = Object.values({ a: 1.5, b: 2.5 });
function use(first, second) {
  console.log(first + 1, second + 1);
}
use(...held);
